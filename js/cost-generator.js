// Illustrative AWS us-east-1 on-demand pricing, simplified for architecture comparison.
// Not a live pricing API — see AWS Pricing Calculator for real quotes.
const PRICING = {
  lambdaPerMillionReq: 0.20,
  lambdaPerGBSecond: 0.0000166667,
  lambdaMemGB: 0.5,
  apiGatewayPerMillionReq: 1.00,
  dynamoPerMillionReq: 1.50,          // blended read+write request-unit cost
  rdsProxyMonthly: 30,                 // extra cost for Lambda -> RDS connection pooling
  fargateVcpuHour: 0.04048,
  fargateGBHour: 0.004445,
  fargateVcpuPerTask: 0.5,
  fargateGBPerTask: 1,
  ec2InstanceHourly: 0.0416,            // t3.medium
  albHourly: 0.0225,
  albLcuHourly: 0.008,
  rdsInstanceHourly: 0.068,             // db.t3.medium
  rdsStorageGB: 20,
  rdsStoragePerGBMonth: 0.115,
  dataTransferPerGB: 0.09,
  avgResponseKB: 50,
};
const HOURS_PER_MONTH = 730;
const SECONDS_PER_MONTH = HOURS_PER_MONTH * 3600;

function computeCosts(inputs){
  const req = inputs.reqPerMonth;
  const durSec = inputs.avgDurationMs / 1000;
  const avgReqSec = req / SECONDS_PER_MONTH;
  const burstMultiplier = inputs.trafficPattern === 'bursty' ? 1.5 : 1;

  const dataTransferGB = (req * PRICING.avgResponseKB * 1024) / 1e9;
  const dataTransferCost = dataTransferGB * PRICING.dataTransferPerGB;

  const rdsCost = PRICING.rdsInstanceHourly * HOURS_PER_MONTH
    + PRICING.rdsStorageGB * PRICING.rdsStoragePerGBMonth;
  const dynamoCost = req * (PRICING.dynamoPerMillionReq / 1e6);

  function storageCost(extraProxy){
    if (inputs.dataNeeds === 'sql') return rdsCost + (extraProxy ? PRICING.rdsProxyMonthly : 0);
    if (inputs.dataNeeds === 'nosql') return dynamoCost;
    return 0;
  }

  // Serverless: API Gateway + Lambda + DynamoDB/RDS
  const lambdaCost = req * (PRICING.lambdaPerMillionReq / 1e6)
    + req * durSec * PRICING.lambdaMemGB * PRICING.lambdaPerGBSecond;
  const apiGwCost = req * (PRICING.apiGatewayPerMillionReq / 1e6);
  const serverless = {
    lambda: lambdaCost, apiGateway: apiGwCost, storage: storageCost(true), dataTransfer: dataTransferCost,
  };
  serverless.total = lambdaCost + apiGwCost + serverless.storage + dataTransferCost;

  // Containers: ALB + ECS Fargate + RDS/DynamoDB
  const containerThroughputPerTask = 50; // req/sec per 0.5vCPU/1GB task
  const tasks = Math.max(2, Math.ceil((avgReqSec / containerThroughputPerTask) * burstMultiplier));
  const fargateCost = tasks * (PRICING.fargateVcpuPerTask * PRICING.fargateVcpuHour
    + PRICING.fargateGBPerTask * PRICING.fargateGBHour) * HOURS_PER_MONTH;
  const albLcus = Math.max(1, Math.ceil(avgReqSec / 25));
  const albCost = PRICING.albHourly * HOURS_PER_MONTH + albLcus * PRICING.albLcuHourly * HOURS_PER_MONTH;
  const containers = {
    compute: fargateCost, loadBalancer: albCost, storage: storageCost(false), dataTransfer: dataTransferCost,
  };
  containers.total = fargateCost + albCost + containers.storage + dataTransferCost;

  // VMs: ALB + EC2 Auto Scaling Group + RDS/self-managed store
  const vmThroughputPerInstance = 40;
  const instances = Math.max(2, Math.ceil((avgReqSec / vmThroughputPerInstance) * burstMultiplier));
  const ec2Cost = instances * PRICING.ec2InstanceHourly * HOURS_PER_MONTH;
  const vms = {
    compute: ec2Cost, loadBalancer: albCost, storage: storageCost(false), dataTransfer: dataTransferCost,
  };
  vms.total = ec2Cost + albCost + vms.storage + dataTransferCost;

  return { serverless, containers, vms, meta: { tasks, instances, avgReqSec } };
}

function computeScores(inputs, costs){
  const scores = { serverless: 50, containers: 50, vms: 40 };

  if (inputs.opsAppetite === 'small') { scores.serverless += 25; scores.containers += 5; scores.vms -= 15; }
  else if (inputs.opsAppetite === 'moderate') { scores.serverless += 10; scores.containers += 20; }
  else { scores.containers += 15; scores.vms += 15; }

  if (inputs.latency === 'high') { scores.serverless -= 20; scores.containers += 10; scores.vms += 10; }
  else if (inputs.latency === 'medium') { scores.serverless -= 5; scores.containers += 5; }

  if (inputs.trafficPattern === 'bursty' || inputs.trafficPattern === 'idle') {
    scores.serverless += 20; scores.containers -= 5; scores.vms -= 10;
  } else if (inputs.trafficPattern === 'steady') {
    scores.serverless -= 5; scores.containers += 10; scores.vms += 10;
  }

  if (inputs.dataNeeds === 'sql') scores.serverless -= 10;
  if (inputs.dataNeeds === 'nosql') scores.serverless += 10;

  const order = Object.entries(costs)
    .filter(([k]) => k !== 'meta')
    .map(([k, v]) => [k, v.total])
    .sort((a, b) => a[1] - b[1]);
  scores[order[0][0]] += 15;
  scores[order[1][0]] += 7;

  Object.keys(scores).forEach(k => { scores[k] = Math.max(5, Math.min(100, Math.round(scores[k]))); });
  return scores;
}

const PROFILES = {
  serverless: {
    label: id => 'Serverless',
    stack: inputs => [
      'API Gateway', 'Lambda',
      inputs.dataNeeds === 'sql' ? 'RDS Proxy' : inputs.dataNeeds === 'nosql' ? 'DynamoDB' : null,
      inputs.dataNeeds === 'sql' ? 'RDS' : null,
    ].filter(Boolean),
    tradeoffs: { 'Ops burden': 'Low', 'Cold start': 'Medium–High', 'Scalability': 'High (auto)', 'Cost predictability': 'Low at high sustained volume', 'Lock-in': 'High' },
    breakdown: c => [['Lambda', c.lambda], ['API Gateway', c.apiGateway], ['Storage', c.storage], ['Data transfer', c.dataTransfer]],
    reasoning(inputs, isBest){
      const bullets = [];
      if (inputs.opsAppetite === 'small') bullets.push({ t: 'Matches your small-team ops capacity — no servers or clusters to patch or scale manually.' });
      if (inputs.trafficPattern === 'bursty' || inputs.trafficPattern === 'idle') bullets.push({ t: 'Pay-per-invocation fits a bursty or mostly-idle traffic pattern — you are not paying for idle capacity.' });
      if (inputs.trafficPattern === 'steady') bullets.push({ t: 'Steady, round-the-clock traffic means you pay full per-request pricing with no idle discount — compare the total against containers below.', watch: true });
      if (inputs.latency === 'high') bullets.push({ t: 'Cold starts can blow a <100ms budget; needs provisioned concurrency, which adds cost back in.', watch: true });
      if (inputs.dataNeeds === 'sql') bullets.push({ t: 'Relational access from Lambda needs RDS Proxy (or Aurora Data API) to avoid connection exhaustion — priced in above.', watch: true });
      return bullets;
    },
  },
  containers: {
    label: () => 'Containers',
    stack: inputs => [
      'ALB', 'ECS Fargate',
      inputs.dataNeeds === 'sql' ? 'RDS' : inputs.dataNeeds === 'nosql' ? 'DynamoDB' : null,
    ].filter(Boolean),
    tradeoffs: { 'Ops burden': 'Medium', 'Cold start': 'Low', 'Scalability': 'High (configured)', 'Cost predictability': 'Medium–High', 'Lock-in': 'Medium' },
    breakdown: c => [['Fargate compute', c.compute], ['Load balancer', c.loadBalancer], ['Storage', c.storage], ['Data transfer', c.dataTransfer]],
    reasoning(inputs, meta){
      const bullets = [];
      if (inputs.opsAppetite !== 'small') bullets.push({ t: 'A middle ground: managed containers give control without owning the underlying instances.' });
      if (inputs.latency === 'high' || inputs.latency === 'medium') bullets.push({ t: 'No cold starts — a warm pool of tasks serves requests immediately, good for latency-sensitive paths.' });
      if (inputs.trafficPattern === 'steady') bullets.push({ t: 'Steady traffic is exactly what Fargate autoscaling is efficient at — predictable task count, predictable bill.' });
      bullets.push({ t: `Sized at ${meta.tasks} task(s) for the traffic you described.` });
      return bullets;
    },
  },
  vms: {
    label: () => 'Virtual Machines',
    stack: inputs => [
      'ALB', 'EC2 Auto Scaling Group',
      inputs.dataNeeds === 'sql' ? 'RDS' : inputs.dataNeeds === 'nosql' ? 'Self-managed NoSQL' : null,
    ].filter(Boolean),
    tradeoffs: { 'Ops burden': 'High', 'Cold start': 'None', 'Scalability': 'Medium (manual tuning)', 'Cost predictability': 'High', 'Lock-in': 'Low' },
    breakdown: c => [['EC2 compute', c.compute], ['Load balancer', c.loadBalancer], ['Storage', c.storage], ['Data transfer', c.dataTransfer]],
    reasoning(inputs, meta){
      const bullets = [];
      if (inputs.opsAppetite === 'dedicated') bullets.push({ t: 'Full control over the OS and runtime is worth the extra patching/scaling ownership when you have a platform team.' });
      if (inputs.opsAppetite === 'small') bullets.push({ t: 'Patching, scaling policy, and OS-level security are now your team’s job — likely more overhead than a small team wants.', watch: true });
      bullets.push({ t: 'Least vendor lock-in of the three — the same AMIs/instances port to another cloud with the least rework.' });
      bullets.push({ t: `Sized at ${meta.instances} instance(s) for the traffic you described.` });
      return bullets;
    },
  },
};

function fmtMoney(n){
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function escapeXml(s){
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderArchDiagram(components){
  const nodes = ['Client', ...components];
  const boxH = 40, gap = 22, padX = 8, y = 12;
  const charW = 5.6, minW = 68, padLabel = 20;
  const widths = nodes.map(label => Math.max(minW, Math.round(label.length * charW) + padLabel));
  const totalW = widths.reduce((a, b) => a + b, 0) + gap * (nodes.length - 1) + padX * 2;
  const totalH = boxH + 24;
  let svg = `<svg viewBox="0 0 ${totalW} ${totalH}" xmlns="http://www.w3.org/2000/svg" class="arch-diagram" role="img" aria-label="${escapeXml(nodes.join(' to '))} request flow">`;

  let x = padX;
  nodes.forEach((label, i) => {
    const w = widths[i];
    const boxClass = i === 0 ? 'diagram-box diagram-client' : 'diagram-box';
    svg += `<rect x="${x}" y="${y}" width="${w}" height="${boxH}" rx="9" class="${boxClass}" />`;
    svg += `<text x="${x + w / 2}" y="${y + boxH / 2 + 4}" text-anchor="middle" class="diagram-label">${escapeXml(label)}</text>`;

    if (i < nodes.length - 1) {
      const midY = y + boxH / 2;
      const lineStart = x + w;
      const tipX = x + w + gap - 2;
      const lineEnd = tipX - 6;
      svg += `<line x1="${lineStart}" y1="${midY}" x2="${lineEnd}" y2="${midY}" class="diagram-arrow" />`;
      svg += `<polygon points="${lineEnd},${midY - 5} ${lineEnd},${midY + 5} ${tipX},${midY}" class="diagram-arrow-head" />`;
    }
    x += w + gap;
  });

  svg += '</svg>';
  return svg;
}

function readInputs(){
  return {
    workloadType: document.getElementById('workloadType').value,
    reqPerMonth: Math.max(1, Number(document.getElementById('reqPerMonth').value) || 0),
    avgDurationMs: Math.max(1, Number(document.getElementById('avgDuration').value) || 0),
    trafficPattern: document.getElementById('trafficPattern').value,
    dataNeeds: document.getElementById('dataNeeds').value,
    latency: document.getElementById('latency').value,
    opsAppetite: document.getElementById('opsAppetite').value,
  };
}

function renderResults(inputs){
  const costs = computeCosts(inputs);
  const scores = computeScores(inputs, costs);
  const bestId = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];

  const order = ['serverless', 'containers', 'vms'];
  const grid = document.getElementById('archGrid');
  grid.innerHTML = order.map(id => {
    const profile = PROFILES[id];
    const cost = costs[id];
    const score = scores[id];
    const isBest = id === bestId;
    const bullets = profile.reasoning(inputs, id === 'serverless' ? isBest : costs.meta);

    const stackArr = profile.stack(inputs);
    const tradeoffRows = Object.entries(profile.tradeoffs)
      .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    const breakdownRows = profile.breakdown(cost)
      .map(([k, v]) => `<div><span>${k}</span><span>${fmtMoney(v)}</span></div>`).join('');
    const bulletItems = bullets
      .map(b => `<li class="${b.watch ? 'watch' : ''}">${b.t}</li>`).join('');

    return `
      <div class="arch-card ${isBest ? 'best' : ''}">
        ${isBest ? '<div class="best-badge">Best fit</div>' : ''}
        <h3>${profile.label()}</h3>
        <div class="diagram-wrap">${renderArchDiagram(stackArr)}</div>
        <p class="arch-stack">${stackArr.join(' + ')}</p>

        <div class="cost-block">
          <div class="cost-num">${fmtMoney(cost.total)}<span style="font-size:13px;">/mo</span></div>
          <div class="cost-lbl">Estimated monthly cost</div>
          <div class="cost-breakdown">${breakdownRows}</div>
        </div>

        <div class="score-row">
          <div class="score-track"><div class="score-fill" style="width:${score}%"></div></div>
          <div class="score-lbl">Fit score: ${score}/100</div>
        </div>

        <table class="tradeoff-table">${tradeoffRows}</table>

        <ul class="reasoning-list">${bulletItems}</ul>
      </div>
    `;
  }).join('');

  document.getElementById('resultsSection').classList.add('show');
}

document.getElementById('generateBtn').addEventListener('click', () => {
  renderResults(readInputs());
  document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.querySelectorAll('.preset').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('reqPerMonth').value = btn.dataset.val;
  });
});
