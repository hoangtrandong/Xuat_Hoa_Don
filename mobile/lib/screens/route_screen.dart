import 'package:flutter/material.dart';

import '../app_store.dart';
import '../format.dart';
import '../mock_data.dart';
import '../widgets.dart';
import 'customer_detail_screen.dart';

class RouteScreen extends StatelessWidget {
  const RouteScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final store = AppStoreScope.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(currentRep, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            Text(
              '$currentRouteName Â· HÃ´m nay',
              style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280), fontWeight: FontWeight.w400),
            ),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          Row(
            children: [
              StatMini(label: 'ÄÃ£ ghÃ©', value: '${store.visitedCount}/${store.customers.length}'),
              const SizedBox(width: 8),
              StatMini(label: 'HoÃ n táº¥t', value: '${store.completedCount}'),
              const SizedBox(width: 8),
              StatMini(label: 'Chá» sync', value: '${store.pendingSyncCount}'),
            ],
          ),
          const SizedBox(height: 16),
          const Text('KhÃ¡ch trong tuyáº¿n', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
          const SizedBox(height: 8),
          ...store.customers.map((c) {
            final visit = store.visitOf(c.id);
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Material(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                child: InkWell(
                  borderRadius: BorderRadius.circular(16),
                  onTap: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => CustomerDetailScreen(customerId: c.id)),
                    );
                  },
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Row(
                      children: [
                        AvatarCircle(name: c.name),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(c.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                              const SizedBox(height: 2),
                              Text(
                                '${c.district} Â· ${c.contactName}',
                                style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280)),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                'CÃ´ng ná»£ ${formatVnd(c.debitBalance)}',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: c.debitBalance > 0 ? const Color(0xFFD97706) : const Color(0xFF059669),
                                ),
                              ),
                            ],
                          ),
                        ),
                        visitChip(visit.status),
                        const SizedBox(width: 4),
                        const Icon(Icons.chevron_right, color: Color(0xFF9CA3AF)),
                      ],
                    ),
                  ),
                ),
              ),
            );
          }),
          const SizedBox(height: 8),
          Text(
            'Luá»“ng: KhÃ¡ch hÃ ng â†’ Viáº¿ng thÄƒm â†’ ÄÆ¡n hÃ ng â†’ Thu tiá»n â†’ Äá»“ng bá»™',
            style: TextStyle(fontSize: 11, color: Colors.grey.shade500),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
