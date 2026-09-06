import 'package:flutter/material.dart';

import '../app_store.dart';
import '../format.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets.dart';

class SyncScreen extends StatelessWidget {
  const SyncScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final store = AppStoreScope.of(context);
    final pending = store.pendingSyncCount;

    return Scaffold(
      appBar: AppBar(title: const Text('Äá»“ng bá»™')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          Card(
            child: SwitchListTile(
              title: const Text('Cháº¿ Ä‘á»™ offline'),
              subtitle: Text(store.offline ? 'HÃ ng Ä‘á»£i giá»¯ local, chÆ°a gá»­i server' : 'Sáºµn sÃ ng gá»­i mock API'),
              value: store.offline,
              activeThumbColor: sky,
              onChanged: store.syncing ? null : (v) => store.setOffline(v),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              StatMini(label: 'Chá» gá»­i', value: '$pending'),
              const SizedBox(width: 8),
              StatMini(
                label: 'ÄÃ£ gá»­i',
                value: '${store.queue.where((q) => q.status == QueueStatus.synced).length}',
              ),
            ],
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: store.offline || store.syncing || pending == 0
                ? null
                : () => store.syncAll(),
            icon: store.syncing
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Icon(Icons.cloud_upload_outlined),
            label: Text(
              store.offline
                  ? 'Táº¯t offline Ä‘á»ƒ Ä‘á»“ng bá»™'
                  : store.syncing
                      ? 'Äang gá»­i...'
                      : 'Äá»“ng bá»™ $pending phiáº¿u',
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Mock: má»—i phiáº¿u delay 450ms. ChÆ°a cÃ³ FastAPI â€” Ä‘Ã¢y lÃ  hÃ ng Ä‘á»£i local.',
            style: TextStyle(fontSize: 11, color: Color(0xFF9CA3AF)),
          ),
          const SizedBox(height: 16),
          const Text('HÃ ng Ä‘á»£i', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          if (store.queue.isEmpty)
            const Text('ChÆ°a cÃ³ phiáº¿u. Check-in / táº¡o Ä‘Æ¡n / thu tiá»n sáº½ xuáº¥t hiá»‡n á»Ÿ Ä‘Ã¢y.')
          else
            ...store.queue.map((item) {
              return Card(
                child: ListTile(
                  leading: Icon(_icon(item.kind), color: sky),
                  title: Text(item.title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                  subtitle: Text('${item.subtitle} Â· ${formatTime(item.createdAt)}'),
                  trailing: _status(item.status),
                ),
              );
            }),
        ],
      ),
    );
  }

  IconData _icon(SyncKind kind) {
    switch (kind) {
      case SyncKind.visit:
        return Icons.place_outlined;
      case SyncKind.order:
        return Icons.receipt_long_outlined;
      case SyncKind.payment:
        return Icons.payments_outlined;
    }
  }

  Widget _status(QueueStatus status) {
    switch (status) {
      case QueueStatus.pending:
        return const StatusChip(label: 'Chá»', color: Color(0xFFD97706));
      case QueueStatus.syncing:
        return const StatusChip(label: 'Gá»­i', color: sky);
      case QueueStatus.synced:
        return const StatusChip(label: 'Xong', color: Color(0xFF059669));
      case QueueStatus.failed:
        return const StatusChip(label: 'Lá»—i', color: Color(0xFFDC2626));
    }
  }
}
