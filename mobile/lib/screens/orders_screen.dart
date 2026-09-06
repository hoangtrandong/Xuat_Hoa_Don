import 'package:flutter/material.dart';

import '../app_store.dart';
import '../format.dart';
import '../theme.dart';

class OrdersScreen extends StatelessWidget {
  const OrdersScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final store = AppStoreScope.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Đơn trong ngày'),
      ),
      body: store.orders.isEmpty
          ? const Center(child: Text('Chưa có đơn. Check-in khách rồi tạo đơn.'))
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
              children: [
                Text(
                  'Tổng ${formatVndFull(store.todayOrderTotal)} · ${store.orders.length} đơn',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 12),
                ...store.orders.map((o) {
                  return Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Text(o.code, style: const TextStyle(fontWeight: FontWeight.w700)),
                              const Spacer(),
                              Text(formatTime(o.createdAt), style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
                            ],
                          ),
                          Text(o.customerName, style: const TextStyle(color: Color(0xFF6B7280))),
                          const SizedBox(height: 8),
                          ...o.lines.map((l) => Text(
                                '${l.quantity} × ${l.productName}',
                                style: const TextStyle(fontSize: 13),
                              )),
                          const Divider(),
                          Align(
                            alignment: Alignment.centerRight,
                            child: Text(
                              formatVndFull(o.total),
                              style: const TextStyle(fontWeight: FontWeight.w800, color: sky),
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                }),
              ],
            ),
    );
  }
}
