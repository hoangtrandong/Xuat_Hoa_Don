String formatVndFull(int n) {
  final negative = n < 0;
  final digits = n.abs().toString();
  final buf = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buf.write('.');
    buf.write(digits[i]);
  }
  return '${negative ? '-' : ''}$buf ₫';
}

String formatVnd(int n) {
  final sign = n < 0 ? '-' : '';
  final abs = n.abs();
  if (abs >= 1000000000) {
    return '$sign${(abs / 1000000000).toStringAsFixed(1)} Tỷ';
  }
  if (abs >= 1000000) {
    return '$sign${(abs / 1000000).toStringAsFixed(1)} Triệu';
  }
  if (abs >= 1000) {
    return '$sign${(abs / 1000).toStringAsFixed(0)}K';
  }
  return '$sign$abs';
}

String formatTime(DateTime t) {
  final hh = t.hour.toString().padLeft(2, '0');
  final mm = t.minute.toString().padLeft(2, '0');
  return '$hh:$mm';
}

String initials(String name) {
  final parts = name.trim().split(RegExp(r'\s+'));
  if (parts.isEmpty || parts.first.isEmpty) return '?';
  if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
  final a = parts[parts.length - 2];
  final b = parts.last;
  return '${a.substring(0, 1)}${b.substring(0, 1)}'.toUpperCase();
}
