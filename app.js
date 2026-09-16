/* ============================================================
   CURRICULUM (used internally so the AI can auto-detect subject
   and answer in the right context — not shown as a manual picker)
   ============================================================ */
const CURRICULUM = {
  "1st Year": {
    branches: ["Common (all branches)"],
    subjects: {
      "Common (all branches)": [
        { code: "BAS101 / BAS201", name: "Engineering Physics" },
        { code: "BAS102 / BAS202", name: "Engineering Chemistry" },
        { code: "BAS103", name: "Engineering Mathematics-I" },
        { code: "BAS203", name: "Engineering Mathematics-II" },
        { code: "BEE101 / BEE201", name: "Fundamentals of Electrical Engineering" },
        { code: "BEC101 / BEC201", name: "Fundamentals of Electronics Engineering" },
        { code: "BCS101 / BCS201", name: "Programming for Problem Solving (C/Python)" },
        { code: "BME101 / BME201", name: "Fundamentals of Mechanical Engineering" },
        { code: "BAS104 / BAS204", name: "Environment and Ecology" },
        { code: "BAS105 / BAS205", name: "Soft Skills / Professional Communication" }
      ]
    }
  },
  "2nd Year": {
    branches: ["CSE"],
    subjects: {
      "CSE": [
        { code: "BCS301", name: "Data Structures" },
        { code: "BCS302", name: "Computer Organization and Architecture" },
        { code: "BCS303", name: "Discrete Structures & Theory of Logic" },
        { code: "BAS303 / BOE3*", name: "Science Based Open Elective / Mathematics-IV" },
        { code: "BAS301 / BVE301", name: "Technical Communication / Universal Human Values & Professional Ethics" },
        { code: "BCC301 / BCC302", name: "Cyber Security / Python Programming" },
        { code: "BCS401", name: "Operating System" },
        { code: "BCS402", name: "Theory of Automata and Formal Languages" },
        { code: "BCS403", name: "Object-Oriented Programming with Java" },
        { code: "BAS403 / BOE4*", name: "Math-IV / Science Based Open Elective" },
        { code: "BAS401 / BVE401", name: "Technical Communication / Universal Human Values & Professional Ethics" },
        { code: "BCC401 / BCC402", name: "Cyber Security / Python Programming" }
      ]
    }
  }
};

/* ============================================================
   AUTH HELPERS (shared storage = simple shared "database")
   ============================================================ */
async function hashPass(pw){
  const enc = new TextEncoder().encode(pw);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function saveSession(user){ sessionStorage.setItem('svnai_user', JSON.stringify(user)); }
function getSession(){
  try{ return JSON.parse(sessionStorage.getItem('svnai_user')); }catch(e){ return null; }
}
function clearSession(){ sessionStorage.removeItem('svnai_user'); }

// Redirect to login if not authenticated. Call at top of protected pages.
function requireAuth(){
  const u = getSession();
  if(!u){ window.location.href = 'index.html'; return null; }
  return u;
}

function logout(){
  clearSession();
  sessionStorage.removeItem('svnai_scope');
  window.location.href = 'index.html';
}

/* ============================================================
   SCOPE (year + branch) chosen on select.html, read on ask.html
   ============================================================ */
function saveScope(year, branch){ sessionStorage.setItem('svnai_scope', JSON.stringify({year, branch})); }
function getScope(){
  try{ return JSON.parse(sessionStorage.getItem('svnai_scope')); }catch(e){ return null; }
}

/* ============================================================
   TOPNAV injector — keeps every page's header consistent
   ============================================================ */
function renderTopnav(current){
  const u = getSession();
  const mount = document.getElementById('topnav-mount');
  if(!mount) return;
  mount.innerHTML = `
    <div class="topnav">
      <div class="brandmark"><b>SVN-AI</b><span>EXAM ANSWER ASSISTANT</span></div>
      <div class="navlinks">
        <a href="select.html" class="${current==='select'?'current':''}">Branch</a>
        <a href="ask.html" class="${current==='ask'?'current':''}">Ask</a>
        <span style="color:#5c6790">${u ? u.name : ''}</span>
        <button class="logout" onclick="logout()">Log out</button>
      </div>
    </div>`;
}

/* ============================================================
   ANSWER RENDERING (light markdown -> HTML)
   ============================================================ */
function escapeHtml(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function boldify(s){ return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'); }
function renderAnswer(text){
  const lines = text.split('\n');
  let html = '', inList = false;
  for(let raw of lines){
    let line = raw.trim();
    if(!line){ if(inList){ html+='</ul>'; inList=false; } continue; }
    if(/^#{1,4}\s+/.test(line)){
      if(inList){ html+='</ul>'; inList=false; }
      html += '<h4>'+escapeHtml(line.replace(/^#{1,4}\s+/,''))+'</h4>';
      continue;
    }
    if(/^[-*]\s+/.test(line) || /^\d+[\.\)]\s+/.test(line)){
      if(!inList){ html+='<ul>'; inList=true; }
      html += '<li>'+boldify(escapeHtml(line.replace(/^[-*]\s+/,'').replace(/^\d+[\.\)]\s+/,'')))+'</li>';
      continue;
    }
    if(inList){ html+='</ul>'; inList=false; }
    html += '<p>'+boldify(escapeHtml(line))+'</p>';
  }
  if(inList) html+='</ul>';
  return html;
}

/* ============================================================
   ASK CLAUDE — auto-detects the subject from the question itself
   (no manual subject picker), then writes a 7-mark answer.
   ============================================================ */
async function askClaudeAutoDetect(scope, questionText, image){
  const subjectList = CURRICULUM[scope.year].subjects[scope.branch]
    .map(s => `- ${s.name} (${s.code})`).join('\n');

  const systemPrompt =
`You are SVN-AI, an exam-answer assistant for B.Tech engineering students, styled after the "Quantum Series" question-answer guides used for university exam preparation.

The student is in: ${scope.year}, ${scope.branch}. Their subjects this year are:
${subjectList}

Your job has two parts:
1. Work out which ONE subject from the list above the student's question belongs to (if the question is from a photo, read the exact question first).
2. Answer it the way a topper would write it for 7 marks in a university exam: precise definitions, step-by-step derivations or explanations, labelled points, and a short worded description of any diagram that would normally be drawn.

Output format (follow exactly):
DETECTED_SUBJECT: <subject name> (<subject code>)
---
<the full answer, using ## for part-headings if the question has multiple parts, and numbered/bulleted steps for derivations or processes>

Do not add anything before "DETECTED_SUBJECT:" and do not mention that you are an AI.`;

  const userContent = [];
  if(image){
    userContent.push({ type:'image', source:{ type:'base64', media_type: image.mediaType, data: image.base64 } });
  }
  userContent.push({
    type:'text',
    text: questionText
      ? `Question: ${questionText}\n\nAnswer this for 7 marks.`
      : `Read the question in the attached image and answer it for 7 marks.`
  });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role:"user", content: userContent }]
    })
  });

  if(!response.ok){ throw new Error('The answer service returned an error (status ' + response.status + ').'); }
  const data = await response.json();
  const textBlock = (data.content || []).find(c => c.type === 'text');
  if(!textBlock){ throw new Error('No answer text was returned.'); }

  const raw = textBlock.text.trim();
  const sep = raw.indexOf('---');
  let detected = 'Subject auto-detected', answer = raw;
  if(sep !== -1 && raw.slice(0, sep).includes('DETECTED_SUBJECT')){
    detected = raw.slice(0, sep).replace('DETECTED_SUBJECT:', '').trim();
    answer = raw.slice(sep + 3).trim();
  }
  return { detected, answer };
}
