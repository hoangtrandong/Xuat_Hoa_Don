import 'package:flutter/material.dart';

import '../app_store.dart';
import '../format.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets.dart';
import 'order_screen.dart';

class VisitScreen extends StatefulWidget {
  const VisitScreen({super.key, required this.customerId});

  final String customerId;

  @override
  State<VisitScreen> createState() => _VisitScreenState();
}

class _VisitScreenState extends State<VisitScreen> {
  final note = TextEditingController();
  bool _ready = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_ready) return;
    _ready = true;
    note.text = AppStoreScope.of(context).visitOf(widget.customerId).note;
  }

  @override
  void dispose() {
    note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final store = AppStoreScope.of(context);
    final c = store.customerById(widget.customerId);
    final visit = store.visitOf(widget.customerId);

    return Scaffold(
      appBar: AppBar(title: const Text('Viếng thăm')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          Text(c.name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          Text('${c.address}, ${c.district}', style: const TextStyle(color: Color(0xFF6B7280))),
          visitChip(visit.status),
          const SizedBox(height: 16),
          Container(
            height: 160,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              gradient: const LinearGradient(
                colors: [Color(0xFFE0F2FE), Color(0xFFBAE6FD)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
            ),
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.my_location, color: sky, size: 32),
                  const SizedBox(height: 8),
                  Text(
                    visit.checkInAt == null
                        ? 'GPS mô phỏng — check-in để ghi tọa độ'
                        : '${visit.lat.toStringAsFixed(5)}, ${visit.lng.toStringAsFixed(5)}',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const Text('Offline · không gọi dịch vụ bản đồ', style: TextStyle(fontSize: 11, color: Color(0xFF6B7280))),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: note,
            maxLines: 3,
            decoration: InputDecoration(
              labelText: 'Ghi chú viếng thăm',
              filled: true,
              fillColor: Colors.white,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
            ),
          ),
          const SizedBox(height: 16),
          if (visit.status == VisitStatus.notStarted)
            FilledButton.icon(
              onPressed: () {
                store.checkIn(widget.customerId, note: note.text.trim());
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Đã check-in. Phiếu nằm trong hàng đợi đồng bộ.')),
                );
              },
              icon: const Icon(Icons.login),
              label: const Text('Check-in'),
            )
          else if (visit.status == VisitStatus.checkedIn) ...[
            Text('Check-in lúc ${formatTime(visit.checkInAt!)}', style: const TextStyle(fontSize: 13)),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => OrderScreen(customerId: widget.customerId)),
                );
              },
              icon: const Icon(Icons.shopping_cart_outlined),
              label: const Text('Tạo đơn hàng'),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () {
                store.completeVisit(widget.customerId, note: note.text.trim());
                Navigator.of(context).pop();
              },
              icon: const Icon(Icons.logout),
              label: const Text('Hoàn tất viếng thăm'),
            ),
          ] else ...[
            Text(
              'Hoàn tất lúc ${visit.checkOutAt != null ? formatTime(visit.checkOutAt!) : ''}',
              style: const TextStyle(fontSize: 13, color: Color(0xFF059669)),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => OrderScreen(customerId: widget.customerId)),
                );
              },
              icon: const Icon(Icons.shopping_cart_outlined),
              label: const Text('Tạo thêm đơn'),
            ),
          ],
        ],
      ),
    );
  }
}
