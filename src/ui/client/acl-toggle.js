document.querySelectorAll('input[name="mode"]').forEach(function(r) {
  r.addEventListener('change', function() {
    document.getElementById('custom-agents').style.display =
      r.value === 'custom' ? 'block' : 'none';
  });
});
