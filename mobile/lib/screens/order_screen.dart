import 'package:flutter/material.dart';

import '../app_store.dart';
import '../format.dart';
import '../models.dart';
import '../theme.dart';
import 'payment_screen.dart';
import 'visit_screen.dart';

class OrderScreen extends StatefulWidget {
  const OrderScreen({super.key, required this.customerId});

  final String customerId;

  @override
  State<OrderScreen> createState() => _OrderScreenState();
}

class _OrderScreenState extends State<OrderScreen> {
  final Map<String, int> qty = {};
  String query = '';

  @override
  Widget build(BuildContext context) {
    final store = AppStoreScope.of(context);
    final c = store.customerById(widget.customerId);
    final visit = store.visitOf(widget.customerId);
    if (visit.status == VisitStatus.notStarted) {
      return Scaffold(
        appBar: AppBar(title: const Text('Tạo đơn')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('Check-in trước khi tạo đơn.', textAlign: TextAlign.center),
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: () {
                    Navigator.of(context).pushReplacement(
                      MaterialPageRoute(builder: (_) => VisitScreen(customerId: widget.customerId)),
                    );
                  },
                  child: const Text('Đi check-in'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final filtered = store.products.where((p) {
      if (!p.active) return false;
      if (query.isEmpty) return true;
      final q = query.toLowerCase();
      return p.name.toLowerCase().contains(q) || p.code.toLowerCase().contains(q);
    }).toList();

    final lines = store.products
        .where((p) => (qty[p.code] ?? 0) > 0)
        .map((p) => OrderLine(
              productCode: p.code,
              productName: p.name,
              unit: p.unit,
              price: p.price,
              quantity: qty[p.code]!,
            ))
        .toList();
    final total = lines.fold(0, (s, l) => s + l.lineTotal);
    final count = lines.fold(0, (s, l) => s + l.quantity);

    return Scaffold(
      appBar: AppBar(title: Text('Đơn · ${c.name}')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: TextField(
              onChanged: (v) => setState(() => query = v),
              decoration: InputDecoration(
                hintText: 'Tìm SKU...',
                prefixIcon: const Icon(Icons.search, size: 20),
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              ),
            ),
          ),
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              itemCount: filtered.length,
              itemBuilder: (context, i) {
                final p = filtered[i];
                final n = qty[p.code] ?? 0;
                return Card(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(p.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                              Text(
                                '${p.code} · ${p.unit} · ${formatVndFull(p.price)}',
                                style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280)),
                              ),
                            ],
                          ),
                        ),
                        IconButton(
                          onPressed: n == 0
                              ? null
                              : () => setState(() => qty[p.code] = n - 1),
                          icon: const Icon(Icons.remove_circle_outline),
                        ),
                        Text('$n', style: const TextStyle(fontWeight: FontWeight.w700)),
                        IconButton(
                          onPressed: () => setState(() => qty[p.code] = n + 1),
                          icon: const Icon(Icons.add_circle_outline, color: sky),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
          Container(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
            decoration: const BoxDecoration(
              color: Colors.white,
              border: Border(top: BorderSide(color: Color(0xFFF3F4F6))),
            ),
            child: Column(
              children: [
                Row(
                  children: [
                    Text('$count SP', style: const TextStyle(color: Color(0xFF6B7280))),
                    const Spacer(),
                    Text(formatVndFull(total), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: sky)),
                  ],
                ),
                const SizedBox(height: 10),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: lines.isEmpty
                        ? null
                        : () {
                            final order = store.placeOrder(customerId: widget.customerId, lines: lines);
                            Navigator.of(context).pushReplacement(
                              MaterialPageRoute(
                                builder: (_) => PaymentScreen(
                                  customerId: widget.customerId,
                                  orderCode: order.code,
                                ),
                              ),
                            );
                          },
                    child: const Text('Xác nhận đơn · sang thu tiền'),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
