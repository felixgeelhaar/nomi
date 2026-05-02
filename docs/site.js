// Copy-to-clipboard for the install command pills.
// Falls back to a manual textarea-select on browsers that don't support
// the async clipboard API (rare in 2026, but trivial to keep).
document.querySelectorAll('button.copy').forEach(btn => {
  btn.addEventListener('click', async () => {
    const text = btn.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove();
    }
    const icon = btn.querySelector('.copy-icon');
    const original = icon.textContent;
    btn.classList.add('copied');
    icon.textContent = '✓';
    setTimeout(() => {
      btn.classList.remove('copied');
      icon.textContent = original;
    }, 1400);
  });
});
