import 'package:flutter/material.dart';

import '../app_store.dart';
import '../format.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets.dart';
import 'order_screen.dart';
import 'payment_screen.dart';
import 'visit_screen.dart';

class CustomerDetailScreen extends StatelessWidget {
  const CustomerDetailScreen({super.key, required this.customerId});

  final String customerId;

  @override
  Widget build(BuildContext context) {
    final store = AppStoreScope.of(context);
    final c = store.customerById(customerId);
    final visit = store.visitOf(customerId);
    final checkedIn = visit.status != VisitStatus.notStarted;

    return Scaffold(
      appBar: AppBar(title: Text(c.name)),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  AvatarCircle(name: c.name, size: 52),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(c.code, style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
                        Text('${c.type} · Tier ${c.tier}', style: const TextStyle(fontWeight: FontWeight.w600)),
                        const SizedBox(height: 4),
                        Text('${c.address}, ${c.district}', style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
                        if (c.storeCode != null || c.companyName != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 4),
                            child: Text(
                              [
                                if (c.storeName != null) 'CH: ${c.storeName}${c.storeCode != null ? ' (${c.storeCode})' : ''}',
                                if (c.companyName != null) 'Công ty: ${c.companyName}',
                              ].join(' · '),
                              style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280)),
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              StatMini(label: 'Công nợ', value: formatVnd(c.debitBalance)),
              const SizedBox(width: 8),
              StatMini(label: 'Doanh số', value: formatVnd(c.totalSpend)),
            ],
          ),
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Expanded(
                        child: Text('1. Viếng thăm', style: TextStyle(fontWeight: FontWeight.w700)),
                      ),
                      visitChip(visit.status),
                    ],
                  ),
                  if (visit.checkInAt != null) ...[
                    const SizedBox(height: 6),
                    Text(
                      'Check-in ${formatTime(visit.checkInAt!)} · ${visit.lat.toStringAsFixed(4)}, ${visit.lng.toStringAsFixed(4)}',
                      style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280)),
                    ),
                  ],
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: () {
                        Navigator.of(context).push(
                          MaterialPageRoute(builder: (_) => VisitScreen(customerId: customerId)),
                        );
                      },
                      icon: Icon(checkedIn ? Icons.map_outlined : Icons.login),
                      label: Text(checkedIn ? 'Mở phiếu viếng' : 'Check-in'),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 10),
          _StepCard(
            step: '2. Tạo đơn',
            subtitle: checkedIn ? 'Đã check-in, có thể đặt hàng' : 'Cần check-in trước',
            icon: Icons.shopping_cart_outlined,
            enabled: checkedIn,
            onTap: () {
              Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => OrderScreen(customerId: customerId)),
              );
            },
          ),
          const SizedBox(height: 10),
          _StepCard(
            step: '3. Thu tiền',
            subtitle: c.debitBalance > 0 ? 'Còn ${formatVndFull(c.debitBalance)}' : 'Không còn công nợ',
            icon: Icons.payments_outlined,
            enabled: c.debitBalance > 0,
            onTap: () {
              Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => PaymentScreen(customerId: customerId)),
              );
            },
          ),
          const SizedBox(height: 16),
          const Text('Đơn hôm nay tại điểm này', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          ...store.ordersOf(customerId).isEmpty
              ? [
                  const Text('Chưa có đơn', style: TextStyle(fontSize: 13, color: Color(0xFF9CA3AF))),
                ]
              : store.ordersOf(customerId).map((o) {
                  return ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(o.code, style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text('${o.lines.length} SKU · ${formatTime(o.createdAt)}'),
                    trailing: Text(formatVndFull(o.total), style: const TextStyle(fontWeight: FontWeight.w700, color: sky)),
                  );
                }),
        ],
      ),
    );
  }
}

class _StepCard extends StatelessWidget {
  const _StepCard({
    required this.step,
    required this.subtitle,
    required this.icon,
    required this.enabled,
    required this.onTap,
  });

  final String step;
  final String subtitle;
  final IconData icon;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: enabled
            ? onTap
            : () {
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(subtitle)));
              },
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Icon(icon, color: enabled ? sky : Colors.grey),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(step, style: const TextStyle(fontWeight: FontWeight.w700)),
                    Text(subtitle, style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: enabled ? sky : Colors.grey),
            ],
          ),
        ),
      ),
    );
  }
}
