document.querySelectorAll('input[name="mode"]').forEach(function(r) {
  r.addEventListener('change', function() {
    document.getElementById('custom-agents').classList.toggle('hidden', r.value !== 'custom');
    var inheritOpt = document.getElementById('inherit-option');
    if (inheritOpt) {
      inheritOpt.classList.toggle('hidden', r.value === 'inherit');
    }
  });
});
