(function () {
  var firebaseConfig = {
    apiKey: "AIzaSyB-svz5mv3rKIlsfgirW9ek8pQGdJ7ucT4",
    authDomain: "travel-app-d351a.firebaseapp.com",
    projectId: "travel-app-d351a",
    storageBucket: "travel-app-d351a.firebasestorage.app",
    messagingSenderId: "505506271990",
    appId: "1:505506271990:web:cf5b3d708df2f3038052d7"
  };
  firebase.initializeApp(firebaseConfig);
  var auth = firebase.auth();
  var db = firebase.firestore();
  var COL = 'trip', CHUNK = 300000, MAX = 9000000;
  var realFetch = window.fetch.bind(window);
  var cur = null, ready = false, unsub = null;
  var cache = { k: '', body: '' };
  window.EventSource = undefined;

  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#faf8f2;color:#2b2a26;display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;font:16px/1.6 -apple-system,Noto Sans TC,sans-serif';
  function show(msg, label, fn) {
    box.innerHTML = '<div style="font-size:42px">🏯</div><div style="font-size:20px;font-weight:700">旅遊 app（家人共用）</div><div style="max-width:320px"></div>' + (label ? '<button style="font:inherit;padding:12px 22px;border-radius:12px;border:0;background:#3d6b3a;color:#fff;cursor:pointer"></button>' : '');
    box.children[2].textContent = msg;
    if (label) { box.children[3].textContent = label; box.children[3].onclick = fn; }
    box.style.display = 'flex';
    if (!box.parentNode) (document.body || document.documentElement).appendChild(box);
  }
  function hide() { box.style.display = 'none'; }
  function login() {
    var p = new firebase.auth.GoogleAuthProvider();
    p.setCustomParameters({ prompt: 'select_account' });
    auth.signInWithPopup(p).catch(function (e) {
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') auth.signInWithRedirect(p);
      else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') alert('登入失敗：' + e.code);
    });
  }

  auth.onAuthStateChanged(function (u) {
    if (unsub) { unsub(); unsub = null; }
    ready = false; cur = null;
    if (!u) { show('請用 Google 帳號登入。只有家人名單內的帳號可以使用。', '使用 Google 登入', login); return; }
    show('登入中，正在讀取雲端資料…');
    unsub = db.collection(COL).onSnapshot(function (snap) {
      var meta = null, ch = {};
      snap.forEach(function (d) { if (d.id === 'meta') meta = d.data(); else ch[d.id] = d.data(); });
      if (!meta) { cur = { version: 0, n: 0, str: null }; }
      else {
        var s = '';
        for (var i = 0; i < meta.n; i++) {
          var c = ch['c' + i];
          if (!c || c.v !== meta.version) return;
          s += c.s;
        }
        cur = { version: meta.version, n: meta.n, str: s };
      }
      ready = true; hide();
    }, function (err) {
      ready = false;
      if (err.code === 'permission-denied') show('這個帳號（' + (u.email || '') + '）不在允許名單內，請換成家人的 Google 帳號。', '換帳號', function () { auth.signOut(); });
      else show('連線失敗：' + err.code, '重新整理', function () { location.reload(); });
    });
  });

  function json(o, st) { return new Response(JSON.stringify(o), { status: st || 200, headers: { 'Content-Type': 'application/json' } }); }
  function split(s) {
    var a = [], i = 0;
    while (i < s.length) {
      var e = Math.min(i + CHUNK, s.length);
      if (e < s.length) { var c = s.charCodeAt(e - 1); if (c >= 0xD800 && c <= 0xDBFF) e--; }
      a.push(s.slice(i, e)); i = e;
    }
    return a;
  }
  function pull() {
    if (!ready) return Promise.resolve(json({ error: 'not ready' }, 503));
    if (!cur.str) return Promise.resolve(json({ data: null, version: 0 }));
    var l = {}; try { l = JSON.parse(localStorage.getItem('kx27') || '{}'); } catch (e) {}
    var k = cur.version + '|' + (l.me || 0) + '|' + (l.pin || '');
    if (cache.k !== k) {
      var d = JSON.parse(cur.str); d.me = l.me || 0; d.pin = l.pin || '';
      cache = { k: k, body: JSON.stringify({ data: d, version: cur.version }) };
    }
    return Promise.resolve(new Response(cache.body, { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }
  function push(opts) {
    if (!ready) return Promise.resolve(json({ error: 'not ready' }, 503));
    var d; try { d = JSON.parse(opts.body).data; delete d.me; delete d.pin; } catch (e) { return Promise.resolve(json({ error: 'bad' }, 400)); }
    var str = JSON.stringify(d);
    if (str.length > MAX) return Promise.resolve(json({ error: 'too big' }, 413));
    var parts = split(str), version = Date.now(), batch = db.batch(), i;
    for (i = 0; i < parts.length; i++) batch.set(db.collection(COL).doc('c' + i), { v: version, i: i, s: parts[i] });
    for (i = parts.length; i < (cur.n || 0); i++) batch.delete(db.collection(COL).doc('c' + i));
    batch.set(db.collection(COL).doc('meta'), { version: version, n: parts.length, by: (auth.currentUser || {}).email || '', at: firebase.firestore.FieldValue.serverTimestamp() });
    cur = { version: version, n: parts.length, str: str };
    return batch.commit().then(function () { return json({ version: version }); }, function () { return json({ error: 'write failed' }, 500); });
  }

  window.fetch = function (url, opts) {
    var u = typeof url === 'string' ? url : (url && url.url) || '';
    if (u.indexOf('/api/sync') === 0) return opts && opts.method === 'POST' ? push(opts) : pull();
    if (u.indexOf('/api/upload') === 0) {
      try { return Promise.resolve(json({ url: JSON.parse(opts.body).data })); } catch (e) { return Promise.resolve(json({ error: '上傳失敗' }, 400)); }
    }
    return realFetch(url, opts);
  };
})();
