export const VIEWER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KimiFlare Session</title>
<style>
:root{--bg:#0d1117;--surface:#161b22;--border:#30363d;--text:#c9d1d9;--muted:#8b949e;--user:#58a6ff;--asst:#3fb950;--tool:#d29922;--sys:#8b949e;--err:#f85149;}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
header{position:sticky;top:0;background:var(--surface);border-bottom:1px solid var(--border);padding:12px 16px;display:flex;align-items:center;gap:12px;z-index:10}
header h1{margin:0;font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
header .meta{color:var(--muted);font-size:12px;margin-left:auto;white-space:nowrap}
header button{background:var(--border);color:var(--text);border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px}
header button:hover{background:#30363d}
main{max-width:900px;margin:0 auto;padding:16px}
.msg{margin-bottom:16px;border:1px solid var(--border);border-radius:8px;background:var(--surface);overflow:hidden}
.msg-header{padding:8px 12px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;gap:8px}
.msg-user .msg-header{color:var(--user);background:rgba(88,166,255,.08)}
.msg-asst .msg-header{color:var(--asst);background:rgba(63,185,80,.08)}
.msg-tool .msg-header{color:var(--tool);background:rgba(210,153,34,.08);cursor:pointer}
.msg-sys .msg-header{color:var(--sys);background:rgba(139,148,158,.08)}
.msg-body{padding:12px;white-space:pre-wrap;word-break:break-word;font-size:14px}
.msg-body code{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;background:rgba(255,255,255,.06);padding:2px 4px;border-radius:4px;font-size:13px}
.msg-body pre{background:rgba(0,0,0,.2);padding:12px;border-radius:6px;overflow-x:auto}
.msg-body pre code{background:none;padding:0}
.tool-details{display:none;padding:12px;border-top:1px solid var(--border);background:rgba(0,0,0,.15);font-size:13px}
.tool-details.open{display:block}
.tool-details pre{margin:0;white-space:pre-wrap;word-break:break-word}
.error{color:var(--err);padding:16px;text-align:center}
.loading{color:var(--muted);padding:40px;text-align:center}
.empty{color:var(--muted);padding:40px;text-align:center}
footer{text-align:center;color:var(--muted);font-size:12px;padding:24px}
</style>
</head>
<body>
<header>
<h1 id="title">KimiFlare Session</h1>
<span class="meta" id="meta"></span>
<button id="copyBtn">Copy transcript</button>
</header>
<main id="main"><div class="loading">Loading session…</div></main>
<footer>Shared via <a href="https://github.com/sinameraji/kimiflare" style="color:var(--muted)">KimiFlare</a></footer>
<script>
const params=new URLSearchParams(location.search);
const sessionId=params.get('session');
const fileUrl=params.get('file');

async function loadSession(){
  let url;
  if(sessionId) url='./api/session/'+encodeURIComponent(sessionId);
  else if(fileUrl) url=fileUrl;
  else{renderError('No session ID or file URL provided.');return}
  const res=await fetch(url);
  if(!res.ok){renderError('Failed to load session: '+res.status);return}
  const data=await res.json();
  render(data);
}

function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

function mdToHtml(text){
  return escapeHtml(text)
    .replace(/\`\`\`([\s\S]*?)\`\`\`/g,'<pre><code>$1</code></pre>')
    .replace(/\`([^\`]+)\`/g,'<code>$1</code>')
    .replace(/\*\*([^\*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/\*([^\*]+)\*/g,'<em>$1</em>')
    .replace(/\n/g,'<br>');
}

function render(session){
  const title=session.title||'Untitled Session';
  document.getElementById('title').textContent=title;
  const model=session.model||'unknown';
  const date=session.createdAt?new Date(session.createdAt).toLocaleString():'';
  const count=(session.messages||[]).filter(m=>m.role!=='system').length;
  document.getElementById('meta').textContent=\`\${model} · \${count} messages · \${date}\`;

  const main=document.getElementById('main');
  main.innerHTML='';
  const msgs=session.messages||[];
  if(!msgs.length){main.innerHTML='<div class="empty">No messages in this session.</div>';return}

  for(const m of msgs){
    if(m.role==='system') continue;
    const div=document.createElement('div');
    div.className='msg msg-'+m.role;
    const header=document.createElement('div');
    header.className='msg-header';
    const label=m.role==='user'?'You':m.role==='assistant'?'Kimi':m.role==='tool'?'Tool':'System';
    header.textContent=label;
    div.appendChild(header);

    if(m.role==='tool'||m.tool_calls){
      const body=document.createElement('div');
      body.className='msg-body';
      if(m.tool_calls){
        for(const tc of m.tool_calls){
          const name=tc.function?.name||tc.name||'tool';
          const args=tc.function?.arguments||tc.arguments||'{}';
          body.innerHTML+='<div><strong>'+escapeHtml(name)+'</strong>('+escapeHtml(args)+')</div>';
        }
      }else{
        body.textContent=typeof m.content==='string'?m.content:JSON.stringify(m.content);
      }
      div.appendChild(body);

      if(m.role==='tool'&&m.content){
        const details=document.createElement('div');
        details.className='tool-details';
        const pre=document.createElement('pre');
        pre.textContent=typeof m.content==='string'?m.content:JSON.stringify(m.content,null,2);
        details.appendChild(pre);
        div.appendChild(details);
        header.addEventListener('click',()=>details.classList.toggle('open'));
        header.innerHTML+=' <span style="font-size:10px;opacity:.7">(click to expand)</span>';
      }
    }else{
      const body=document.createElement('div');
      body.className='msg-body';
      const text=typeof m.content==='string'?m.content:(m.content||[]).map(p=>p.type==='text'?p.text:'').join('');
      body.innerHTML=mdToHtml(text);
      div.appendChild(body);
    }
    main.appendChild(div);
  }

  document.getElementById('copyBtn').addEventListener('click',()=>{
    const lines=[];
    for(const m of msgs){
      if(m.role==='system') continue;
      const label=m.role==='user'?'You':m.role==='assistant'?'Kimi':m.role==='tool'?'Tool':'System';
      const text=typeof m.content==='string'?m.content:(m.content||[]).map(p=>p.type==='text'?p.text:'').join('');
      lines.push(label+':\\n'+text);
    }
    navigator.clipboard.writeText(lines.join('\\n\\n')).then(()=>{
      const btn=document.getElementById('copyBtn');
      const old=btn.textContent;
      btn.textContent='Copied!';
      setTimeout(()=>btn.textContent=old,1500);
    });
  });
}

function renderError(msg){
  document.getElementById('main').innerHTML='<div class="error">'+escapeHtml(msg)+'</div>';
}

loadSession().catch(e=>renderError(e.message));
</script>
</body>
</html>`;
