function go(tab){
  document.querySelectorAll('.navlinks button').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  document.querySelectorAll('main section').forEach(s=>s.classList.toggle('active', s.id===tab));
  window.scrollTo({top:0, behavior:'smooth'});
}
document.querySelectorAll('.navlinks button').forEach(b=>{
  b.addEventListener('click', ()=>go(b.dataset.tab));
});
