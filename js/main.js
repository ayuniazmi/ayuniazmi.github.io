function go(tab, skipScrollTop){
  document.querySelectorAll('.navlinks button').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  document.querySelectorAll('main section').forEach(s=>s.classList.toggle('active', s.id===tab));
  if(!skipScrollTop) window.scrollTo({top:0, behavior:'smooth'});
}
document.querySelectorAll('.navlinks button').forEach(b=>{
  b.addEventListener('click', ()=>go(b.dataset.tab));
});

// Journal entries: collapse/expand in place, deep-linkable via #entry-id
document.querySelectorAll('.jcard').forEach(card=>{
  const toggle = card.querySelector('.j-toggle');
  const share = card.querySelector('.j-share');
  if(toggle){
    toggle.addEventListener('click', ()=>{
      const expanded = card.classList.toggle('expanded');
      toggle.innerHTML = expanded ? 'Show less &uarr;' : 'Read full entry &darr;';
      if(expanded && card.id) history.replaceState(null, '', '#'+card.id);
    });
  }
  if(share){
    share.addEventListener('click', ()=>{
      const url = location.origin + location.pathname + '#' + card.id;
      const original = share.innerHTML;
      const done = ()=>{ share.textContent = 'Copied!'; setTimeout(()=>{ share.innerHTML = original; }, 1500); };
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(url).then(done).catch(()=>window.prompt('Copy this link:', url));
      } else {
        window.prompt('Copy this link:', url);
      }
    });
  }
});

function openJournalEntryFromHash(){
  const id = location.hash.slice(1);
  if(!id) return;
  const card = document.getElementById(id);
  if(!card || !card.classList.contains('jcard')) return;
  go('journal', true);
  card.classList.add('expanded');
  const toggle = card.querySelector('.j-toggle');
  if(toggle) toggle.innerHTML = 'Show less &uarr;';
  setTimeout(()=>card.scrollIntoView({behavior:'smooth', block:'start'}), 60);
}
openJournalEntryFromHash();
window.addEventListener('hashchange', openJournalEntryFromHash);
