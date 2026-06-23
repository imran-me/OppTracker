<?php /* EON — standalone demo page. Runs on any PHP host; also works opened
         directly as a static file (PHP just adds the version stamp). */
$ver = @include __DIR__ . '/config/settings.php';
$v = isset($EON_CONFIG['version']) ? $EON_CONFIG['version'] : '1.0.0';
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EON · EPAL AI Companion — Demo</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap" rel="stylesheet">

  <!-- EON stylesheets (the only three the module needs) -->
  <link rel="stylesheet" href="./css/companion.css">
  <link rel="stylesheet" href="./css/home.css">
  <link rel="stylesheet" href="./css/animations.css">

  <style>
    body { margin: 0; font-family: "Plus Jakarta Sans", system-ui, sans-serif;
      background: radial-gradient(1200px 600px at 70% -10%, #eaf0ff, #f5f7fb); color: #16203a; }
    .wrap { max-width: 760px; margin: 0 auto; padding: 48px 24px 220px; }
    h1 { font-size: 30px; margin: 0 0 6px; }
    .sub { color: #5b6b86; margin: 0 0 28px; }
    .card { background: #fff; border: 1px solid #e7eaf1; border-radius: 16px;
      padding: 22px; box-shadow: 0 6px 22px rgba(16,24,40,.06); margin-bottom: 18px; }
    label { display:block; font-size: 13px; font-weight: 600; margin: 10px 0 6px; }
    input, textarea { width: 100%; box-sizing: border-box; padding: 10px 12px;
      border: 1px solid #d8deea; border-radius: 10px; font: inherit; }
    .btn { border: none; border-radius: 10px; padding: 10px 16px; font: 600 14px/1 inherit;
      color: #fff; background: #1f6dff; cursor: pointer; margin: 6px 6px 0 0; }
    .btn.lime { background: #5bb52f; } .btn.violet { background: #7b54e0; }
    .pill { display:inline-block; font-size:12px; background:#eef0fe; color:#3730a3;
      padding:4px 10px; border-radius: 999px; font-weight:700; }
    .toast { position: fixed; left: 24px; bottom: 24px; padding: 12px 16px; border-radius: 12px;
      color:#fff; font-weight:600; box-shadow:0 10px 30px rgba(0,0,0,.15); opacity:0;
      transform: translateY(10px); transition:.25s; z-index: 10; }
    .toast.show { opacity:1; transform: translateY(0); }
    .toast.success { background:#0f9d58; } .toast.danger { background:#d6453d; }
  </style>
</head>
<body>
  <div class="wrap">
    <span class="pill">EON v<?php echo htmlspecialchars($v); ?> · live demo</span>
    <h1>Meet EON 🌱</h1>
    <p class="sub">Your living digital coworker. Try the controls below and watch EON react —
       type, click, submit the form, or trigger a notification. Leave the tab idle to see EON
       go home, relax, and eventually sleep. Click EON for a surprise.</p>

    <div class="card">
      <h3 style="margin-top:0">Try a reaction</h3>
      <button class="btn" onclick="toast('success')">Show success ✔</button>
      <button class="btn violet" onclick="toast('danger')">Show error ✕</button>
      <button class="btn lime" onclick="window.EON?.emotion.react('celebrating',{priority:3})">Celebrate 🎉</button>
      <button class="btn" onclick="window.EON?.emotion.react('thinking',{priority:2})">Think 🤔</button>
      <button class="btn violet" onclick="window.EON?.character.setState('dance')">Dance 🎶</button>
    </div>

    <form class="card" onsubmit="event.preventDefault(); toast('success');">
      <h3 style="margin-top:0">Submit a form</h3>
      <label>Name</label>
      <input type="text" placeholder="Type here — EON walks over to watch…">
      <label>Notes</label>
      <textarea rows="3" placeholder="Keep typing…"></textarea>
      <button class="btn" type="submit">Submit</button>
    </form>

    <div class="card">
      <h3 style="margin-top:0">Idle behaviour</h3>
      <p style="color:#5b6b86;margin:0">After 5 min → walks home · 10 min → tea / reading ·
         20 min → sleeps. Move the mouse or click to wake EON with a wave.</p>
    </div>
  </div>

  <!-- success/error toast (EON's MutationObserver reacts to these automatically) -->
  <div class="toast" id="demoToast"></div>

  <!-- Three.js via import-map (no build step) -->
  <script type="importmap">
  {
    "imports": {
      "three": "https://unpkg.com/three@0.160.0/build/three.module.js"
    }
  }
  </script>

  <!-- EON boots itself -->
  <script type="module" src="./js/main.js"></script>

  <script>
    function toast(kind) {
      const t = document.getElementById('demoToast');
      t.className = 'toast ' + kind + ' show';
      t.textContent = kind === 'success' ? 'Saved successfully' : 'Something went wrong';
      setTimeout(() => t.classList.remove('show'), 2200);
    }
  </script>
</body>
</html>
