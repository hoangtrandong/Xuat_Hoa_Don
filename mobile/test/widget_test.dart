import 'package:flutter_test/flutter_test.dart';

import 'package:dms_sales/main.dart';

void main() {
  testWidgets('shows route customers', (tester) async {
    await tester.pumpWidget(const DmsSalesApp());
    expect(find.text('Nguyễn Văn A'), findsOneWidget);
    expect(find.text('Đại lý Phú Phong'), findsOneWidget);
    expect(find.text('Tuyến'), findsWidgets);
  });
}
