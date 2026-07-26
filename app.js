import {
  auth, db, signIn, signOutUser, onAuthStateChanged, doc, setDoc, getDoc, onSnapshot
} from './firebase-init.js';

// ---------- storage ----------
const STORAGE_KEY = 'workoutAppData_v1';

function loadData(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      if(!parsed.history) parsed.history = [];
      return parsed;
    }
  }catch(e){}
  return { workouts: [], history: [] };
}

// true while we're writing data that just came FROM the cloud, so we don't echo it right back up
let applyingRemote = false;
let cloudSaveTimer = null;
let currentUser = null;
let unsubscribeSnapshot = null;

function cloudDocRef(uid){ return doc(db, 'users', uid); }

function saveData(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  if(currentUser && !applyingRemote){
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(() => {
      setDoc(cloudDocRef(currentUser.uid), { payload: JSON.stringify(data), updatedAt: Date.now() }).catch(()=>{});
    }, 600);
  }
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if(unsubscribeSnapshot){ unsubscribeSnapshot(); unsubscribeSnapshot = null; }

  if(user){
    const ref = cloudDocRef(user.uid);
    const snap = await getDoc(ref);
    if(snap.exists()){
      applyingRemote = true;
      data = JSON.parse(snap.data().payload);
      if(!data.history) data.history = [];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      applyingRemote = false;
    } else {
      await setDoc(ref, { payload: JSON.stringify(data), updatedAt: Date.now() });
    }
    unsubscribeSnapshot = onSnapshot(ref, (snap) => {
      if(!snap.exists()) return;
      // skip echoes of our own writes so typing doesn't get interrupted by a re-render
      if(snap.metadata.hasPendingWrites) return;
      applyingRemote = true;
      data = JSON.parse(snap.data().payload);
      if(!data.history) data.history = [];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      applyingRemote = false;
      render();
    });
  }
  render();
});

let data = loadData();

// ---------- id helper ----------
function uid(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2,8);
}

// ---------- view state (not persisted) ----------
let view = { name: 'home' }; // home | editList | editWorkout | session
// per-exercise tap sequence during a session (runtime only, reset on load)
let seqState = {}; // exerciseId -> array of weights tapped since last full cycle

function setView(v){
  view = v;
  render();
}

// ---------- helpers ----------
function getWorkout(id){
  return data.workouts.find(w => w.id === id);
}
function getExercise(workout, id){
  return workout.exercises.find(e => e.id === id);
}

function defaultSlots(sets){
  return new Array(sets).fill(null);
}

function ensureRuntime(exercise){
  if(!exercise.slots || exercise.slots.length !== exercise.sets){
    exercise.slots = defaultSlots(exercise.sets);
  }
}

// tap algorithm: sequence of taps since last full/reset.
// all taps but the last commit exactly one slot; the last tap fills all remaining slots.
function tapWeight(workout, exercise, weight){
  const N = exercise.sets;
  let seq = seqState[exercise.id] || [];
  if(seq.length >= N){
    seq = [];
  }
  seq.push(weight);
  seqState[exercise.id] = seq;

  const slots = new Array(N).fill(null);
  const k = seq.length;
  for(let i=0;i<k-1;i++){
    slots[i] = seq[i];
  }
  for(let i=k-1;i<N;i++){
    slots[i] = seq[k-1];
  }
  exercise.slots = slots;
  saveData();
  render();
}

// finalize the current session: whatever is filled becomes "last performance",
// gets appended to history, then the board clears for next time.
function saveSession(workoutId){
  const w = getWorkout(workoutId);
  if(!w) return;

  const loggedExercises = [];
  w.exercises.forEach(ex => {
    ensureRuntime(ex);
    const hasAny = ex.slots.some(s => s !== null);
    if(hasAny){
      ex.lastLog = ex.slots.slice();
      loggedExercises.push({ name: ex.name, sets: ex.sets, reps: ex.reps, slots: ex.slots.slice() });
    }
    ex.slots = defaultSlots(ex.sets);
    seqState[ex.id] = [];
  });

  if(loggedExercises.length){
    data.history.unshift({
      id: uid(),
      workoutId: w.id,
      workoutName: w.name,
      date: Date.now(),
      exercises: loggedExercises
    });
    if(data.history.length > 200) data.history.length = 200;
  }

  saveData();
  showToast(loggedExercises.length ? 'Workout saved' : 'Nothing to save');
  setView({name:'home'});
}

// ---------- toast ----------
let toastTimer = null;
function showToast(msg){
  let el = document.getElementById('toast');
  if(!el){
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

// adds whatever's in the exercise's "add weight" input, then clears + refocuses it
// so the user can keep typing more weights without re-tapping the field each time.
function addWeight(exId){
  const app = document.getElementById('app');
  const w = getWorkout(view.workoutId);
  const ex = getExercise(w, exId);
  const input = app.querySelector(`[data-new-weight="${exId}"]`);
  const val = parseFloat(input.value);
  if(!isNaN(val)){
    ex.weights.push(val);
    ex.weights.sort((a,b)=>a-b);
    saveData();
  }
  render();
  const newInput = document.getElementById('app').querySelector(`[data-new-weight="${exId}"]`);
  if(newInput) newInput.focus();
}

function resetExerciseSlots(workout, exercise){
  seqState[exercise.id] = [];
  exercise.slots = defaultSlots(exercise.sets);
  saveData();
  render();
}

// ---------- render root ----------
// re-rendering replaces the whole #app subtree, which would normally kill focus/cursor
// position and the on-screen keyboard mid-keystroke; save + restore it around the swap.
const FOCUS_ATTRS = ['data-field', 'data-exercise', 'data-new-weight', 'data-workout', 'data-image-input'];

function captureFocus(app){
  const el = document.activeElement;
  if(!el || !app.contains(el)) return null;
  const selector = FOCUS_ATTRS
    .filter(attr => el.hasAttribute(attr))
    .map(attr => `[${attr}="${CSS.escape(el.getAttribute(attr))}"]`)
    .join('');
  if(!selector) return null;
  return {
    selector,
    tag: el.tagName,
    selectionStart: 'selectionStart' in el ? el.selectionStart : null,
    selectionEnd: 'selectionEnd' in el ? el.selectionEnd : null
  };
}

function restoreFocus(app, info){
  if(!info) return;
  const el = app.querySelector(info.tag.toLowerCase() + info.selector);
  if(!el) return;
  el.focus();
  if(info.selectionStart !== null && typeof el.setSelectionRange === 'function'){
    try{ el.setSelectionRange(info.selectionStart, info.selectionEnd); }catch(e){}
  }
}

function render(){
  const app = document.getElementById('app');
  const focusInfo = captureFocus(app);
  if(view.name === 'home') app.innerHTML = renderHome();
  else if(view.name === 'editList') app.innerHTML = renderEditList();
  else if(view.name === 'editWorkout') app.innerHTML = renderEditWorkout(view.workoutId);
  else if(view.name === 'session') app.innerHTML = renderSession(view.workoutId);
  else if(view.name === 'history') app.innerHTML = renderHistory();
  attachHandlers();
  restoreFocus(app, focusInfo);
}

// ---------- HOME ----------
function renderHome(){
  const list = data.workouts.map(w => `
    <button class="workout-btn" data-action="start" data-workout="${w.id}">
      <span>
        ${escapeHtml(w.name)}
        <span class="sub">${w.exercises.length} exercise${w.exercises.length===1?'':'s'}</span>
      </span>
      <span class="chev">›</span>
    </button>
  `).join('');

  const empty = data.workouts.length === 0 ? `
    <div class="empty-state">
      No workouts yet.<br>Tap the pencil to set one up.
    </div>` : '';

  return `
    <div class="topbar">
      <div class="title"><h1>Workout</h1></div>
      ${currentUser
        ? `<button class="icon-btn" data-action="sign-out" title="Signed in as ${escapeAttr(currentUser.email || currentUser.displayName || '')} — tap to sign out">☁️✓</button>`
        : `<button class="icon-btn" data-action="sign-in" title="Sign in to sync across devices">☁️</button>`}
      <button class="icon-btn" data-action="goto-history" title="Past workouts">⏱</button>
      <button class="icon-btn" data-action="goto-edit-list" title="Edit workouts">✎</button>
    </div>
    <div class="stack">
      ${list}
      ${empty}
    </div>
  `;
}

// ---------- HISTORY ----------
function renderHistory(){
  const entries = data.history.map(h => {
    const d = new Date(h.date);
    const dateStr = d.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });
    const timeStr = d.toLocaleTimeString(undefined, { hour:'numeric', minute:'2-digit' });
    const exList = h.exercises.map(ex => `
      <div class="history-exercise">
        <span class="history-exercise-name">${escapeHtml(ex.name)}</span>
        <span class="history-exercise-log">${formatSlots(ex.slots) || '—'}</span>
      </div>
    `).join('');
    return `
      <div class="history-card">
        <div class="history-head">
          <span class="history-name">${escapeHtml(h.workoutName)}</span>
          <span class="history-date">${dateStr} · ${timeStr}</span>
        </div>
        ${exList}
      </div>
    `;
  }).join('');

  const empty = data.history.length === 0 ? `
    <div class="empty-state">No saved workouts yet.<br>Finish a session and hit Save.</div>` : '';

  return `
    <div class="topbar">
      <button class="icon-btn" data-action="goto-home">←</button>
      <div class="title"><h1>History</h1></div>
      <span style="width:36px"></span>
    </div>
    <div class="stack">
      ${entries}
      ${empty}
      <div class="footer-space"></div>
    </div>
  `;
}

// ---------- EDIT LIST ----------
function renderEditList(){
  const list = data.workouts.map(w => `
    <div class="workout-btn" style="cursor:pointer" data-action="edit-workout" data-workout="${w.id}">
      <span>
        ${escapeHtml(w.name)}
        <span class="sub">${w.exercises.length} exercise${w.exercises.length===1?'':'s'}</span>
      </span>
      <span class="chev">✎</span>
    </div>
  `).join('');

  return `
    <div class="topbar">
      <button class="icon-btn" data-action="goto-home">←</button>
      <div class="title"><h1>Edit Workouts</h1></div>
      <span style="width:36px"></span>
    </div>
    <div class="stack">
      ${list}
      <button class="full add-workout-btn" data-action="add-workout">+ New Workout</button>
    </div>
  `;
}

// ---------- EDIT WORKOUT ----------
function renderEditWorkout(workoutId){
  const w = getWorkout(workoutId);
  if(!w){ setView({name:'editList'}); return ''; }

  const exercises = w.exercises.map(ex => `
    <div class="exercise-edit-card" data-exercise="${ex.id}">
      <div class="row">
        <label class="field" style="flex:2">
          Exercise name
          <input type="text" data-field="name" data-exercise="${ex.id}" value="${escapeAttr(ex.name)}" placeholder="e.g. Bench Press">
        </label>
      </div>
      <div class="row">
        <label class="field">
          Series
          <input type="number" inputmode="numeric" min="1" max="12" data-field="sets" data-exercise="${ex.id}" value="${ex.sets}">
        </label>
        <label class="field">
          Reps
          <input type="number" inputmode="numeric" min="1" max="100" data-field="reps" data-exercise="${ex.id}" value="${ex.reps}">
        </label>
      </div>
      <label class="field">
        Weight options
        <div class="row wrap" style="margin-top:4px">
          ${ex.weights.map((wt,i) => `
            <span class="weight-chip">
              ${wt}
              <button data-action="remove-weight" data-exercise="${ex.id}" data-index="${i}">×</button>
            </span>
          `).join('')}
          <span class="row" style="gap:6px">
            <input type="number" inputmode="decimal" step="any" placeholder="add" style="width:70px" data-new-weight="${ex.id}">
            <button data-action="add-weight" data-exercise="${ex.id}">+</button>
          </span>
        </div>
      </label>
      <label class="field">
        Picture / GIF
        <div class="row" style="gap:10px;align-items:center">
          ${ex.image ? `<img src="${ex.image}" class="exercise-thumb" data-action="preview-image" data-exercise="${ex.id}">` : ''}
          <label class="btn ghost" style="cursor:pointer">
            ${ex.image ? 'Replace' : 'Add image'}
            <input type="file" accept="image/*" data-image-input="${ex.id}" style="display:none">
          </label>
          ${ex.image ? `<button class="danger-text" style="background:none" data-action="remove-image" data-exercise="${ex.id}">Remove</button>` : ''}
        </div>
      </label>
      <button class="danger-text" style="background:none;align-self:flex-start" data-action="delete-exercise" data-exercise="${ex.id}">Delete exercise</button>
    </div>
  `).join('');

  return `
    <div class="topbar">
      <button class="icon-btn" data-action="goto-edit-list">←</button>
      <div class="title"><h1>Edit Workout</h1></div>
      <button class="icon-btn danger-text" data-action="delete-workout" data-workout="${w.id}">🗑</button>
    </div>
    <div class="stack">
      <label class="field">
        Workout name
        <input type="text" data-field="workout-name" value="${escapeAttr(w.name)}">
      </label>
      <div class="divider"></div>
      ${exercises}
      <button class="full add-exercise-btn" data-action="add-exercise" data-workout="${w.id}">+ Add Exercise</button>
      <div class="footer-space"></div>
      <button class="full primary" data-action="goto-edit-list">Done</button>
    </div>
  `;
}

// ---------- SESSION ----------
function renderSession(workoutId){
  const w = getWorkout(workoutId);
  if(!w){ setView({name:'home'}); return ''; }

  const cards = w.exercises.map(ex => {
    ensureRuntime(ex);
    const slotsHtml = ex.slots.map(s => `
      <div class="slot ${s!==null?'filled':''}">${s!==null ? s : '—'}</div>
    `).join('');
    const weightsHtml = ex.weights.map(wt => `
      <button class="weight-btn" data-action="tap-weight" data-workout="${w.id}" data-exercise="${ex.id}" data-weight="${wt}">${wt}</button>
    `).join('');
    const lastFormatted = ex.lastLog ? formatSlots(ex.lastLog) : null;
    const lastLine = lastFormatted ? `<div class="last">Last time: ${lastFormatted}</div>` : `<div class="last muted-italic">No history yet</div>`;

    return `
      <div class="exercise-session-card">
        <div class="head">
          <div>
            <h3>${escapeHtml(ex.name)}</h3>
            <div class="meta">${ex.sets} × ${ex.reps} reps</div>
            ${lastLine}
          </div>
          ${ex.image ? `<img src="${ex.image}" class="exercise-thumb" data-action="preview-image" data-exercise="${ex.id}">` : ''}
        </div>
        <div class="slots">${slotsHtml}</div>
        ${ex.weights.length ? `<div class="weight-buttons">${weightsHtml}</div>` : `<div class="small-muted">No weights set up for this exercise.</div>`}
        <div class="row" style="justify-content:flex-end">
          <button class="reset-link" data-action="reset-exercise" data-workout="${w.id}" data-exercise="${ex.id}">reset</button>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="topbar">
      <button class="icon-btn" data-action="goto-home">←</button>
      <div class="title"><h1>${escapeHtml(w.name)}</h1></div>
      <span style="width:36px"></span>
    </div>
    <div class="stack session-stack">
      ${cards}
      <div class="save-bar-space"></div>
    </div>
    <div class="save-bar">
      <button class="full primary save-btn" data-action="save-session" data-workout="${w.id}">Save Workout</button>
    </div>
  `;
}

// ---------- formatting ----------
// turns [43,43,45,45] into "2x43 + 2x45"
function formatSlots(slots){
  if(!slots || slots.every(s => s === null)) return null;
  const groups = [];
  for(const s of slots){
    if(s === null) continue;
    const last = groups[groups.length - 1];
    if(last && last.weight === s) last.count++;
    else groups.push({ weight: s, count: 1 });
  }
  if(groups.length === 0) return null;
  return groups.map(g => `${g.count}x${g.weight}`).join(' + ');
}

// ---------- escaping ----------
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s){ return escapeHtml(s); }

// ---------- event delegation ----------
function attachHandlers(){
  const app = document.getElementById('app');

  app.onclick = (e) => {
    const btn = e.target.closest('[data-action]');
    if(!btn) return;
    const action = btn.dataset.action;

    if(action === 'sign-in'){
      signIn().catch(err => alert('Sign-in failed: ' + err.message));
    }
    else if(action === 'sign-out'){
      if(confirm('Sign out? Your data will stay on this device but stop syncing.')) signOutUser();
    }
    else if(action === 'goto-home') setView({name:'home'});
    else if(action === 'goto-edit-list') setView({name:'editList'});
    else if(action === 'start') setView({name:'session', workoutId: btn.dataset.workout});
    else if(action === 'edit-workout') setView({name:'editWorkout', workoutId: btn.dataset.workout});
    else if(action === 'goto-history') setView({name:'history'});
    else if(action === 'save-session') saveSession(btn.dataset.workout);

    else if(action === 'add-workout'){
      const w = { id: uid(), name: 'New Workout', exercises: [] };
      data.workouts.push(w);
      saveData();
      setView({name:'editWorkout', workoutId: w.id});
    }

    else if(action === 'delete-workout'){
      if(confirm('Delete this workout?')){
        data.workouts = data.workouts.filter(w => w.id !== btn.dataset.workout);
        saveData();
        setView({name:'editList'});
      }
    }

    else if(action === 'add-exercise'){
      const w = getWorkout(btn.dataset.workout);
      w.exercises.push({ id: uid(), name: '', sets: 4, reps: 10, weights: [], slots: null, lastLog: null, image: null });
      saveData();
      render();
    }

    else if(action === 'remove-image'){
      const w = getWorkout(view.workoutId);
      const ex = getExercise(w, btn.dataset.exercise);
      ex.image = null;
      saveData();
      render();
    }

    else if(action === 'preview-image'){
      window.open(btn.src, '_blank');
    }

    else if(action === 'delete-exercise'){
      const workoutId = view.workoutId;
      const w = getWorkout(workoutId);
      w.exercises = w.exercises.filter(ex => ex.id !== btn.dataset.exercise);
      saveData();
      render();
    }

    else if(action === 'add-weight'){
      addWeight(btn.dataset.exercise);
    }

    else if(action === 'remove-weight'){
      const exId = btn.dataset.exercise;
      const idx = parseInt(btn.dataset.index,10);
      const w = getWorkout(view.workoutId);
      const ex = getExercise(w, exId);
      ex.weights.splice(idx,1);
      saveData();
      render();
    }

    else if(action === 'tap-weight'){
      const w = getWorkout(btn.dataset.workout);
      const ex = getExercise(w, btn.dataset.exercise);
      const weight = parseFloat(btn.dataset.weight);
      tapWeight(w, ex, weight);
    }

    else if(action === 'reset-exercise'){
      const w = getWorkout(btn.dataset.workout);
      const ex = getExercise(w, btn.dataset.exercise);
      resetExerciseSlots(w, ex);
    }
  };

  app.onfocusin = (e) => {
    if(e.target.tagName === 'INPUT' && e.target.type === 'number'){
      e.target.select();
    }
  };

  app.onkeydown = (e) => {
    if(e.key === 'Enter' && e.target.dataset.newWeight){
      e.preventDefault();
      addWeight(e.target.dataset.newWeight);
    }
  };

  app.onchange = (e) => {
    const t = e.target;
    if(t.dataset.imageInput){
      const file = t.files && t.files[0];
      if(!file) return;
      const exId = t.dataset.imageInput;
      const reader = new FileReader();
      reader.onload = () => {
        const w = getWorkout(view.workoutId);
        const ex = getExercise(w, exId);
        ex.image = reader.result;
        saveData();
        render();
      };
      reader.readAsDataURL(file);
    }
  };

  app.oninput = (e) => {
    const t = e.target;
    if(t.dataset.field === 'workout-name'){
      const w = getWorkout(view.workoutId);
      w.name = t.value;
      saveData();
    } else if(t.dataset.field === 'name'){
      const w = getWorkout(view.workoutId);
      const ex = getExercise(w, t.dataset.exercise);
      ex.name = t.value;
      saveData();
    } else if(t.dataset.field === 'sets'){
      const w = getWorkout(view.workoutId);
      const ex = getExercise(w, t.dataset.exercise);
      const n = parseInt(t.value,10);
      ex.sets = (n>0) ? n : 1;
      ex.slots = defaultSlots(ex.sets);
      ex.lastLog = null;
      saveData();
    } else if(t.dataset.field === 'reps'){
      const w = getWorkout(view.workoutId);
      const ex = getExercise(w, t.dataset.exercise);
      const n = parseInt(t.value,10);
      ex.reps = (n>0) ? n : 1;
      saveData();
    }
  };

}

render();
