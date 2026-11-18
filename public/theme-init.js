(function () {
  try {
    var saved = localStorage.getItem('ov_theme');
    var mode = saved === 'light' || saved === 'dark' ? saved : 'system';
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var shouldBeDark = mode === 'dark' || (mode === 'system' && prefersDark);
    document.documentElement.classList.toggle('dark', shouldBeDark);
    var meta = document.getElementById('ov-theme-color');
    if (meta) {
      meta.setAttribute('content', shouldBeDark ? '#0b0f19' : '#f8fafc');
    }
  } catch (_e) {
    // Ignore restricted storage environments
  }
})();
