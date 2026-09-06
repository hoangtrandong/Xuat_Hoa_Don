import 'package:flutter/material.dart';

import '../app_store.dart';
import '../format.dart';
import '../theme.dart';

class PaymentScreen extends StatefulWidget {
  const PaymentScreen({super.key, required this.customerId, this.orderCode});

  final String customerId;
  final String? orderCode;

  @override
  State<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends State<PaymentScreen> {
  final controller = TextEditingController();
  final methods = const ['Tiền mặt', 'Chuyển khoản', 'COD'];
  String method = 'Tiền mặt';
  bool _ready = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_ready) return;
    _ready = true;
    final debit = AppStoreScope.of(context).customerById(widget.customerId).debitBalance;
    controller.text = '$debit';
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  int get amount => int.tryParse(controller.text.replaceAll('.', '')) ?? 0;

  @override
  Widget build(BuildContext context) {
    final store = AppStoreScope.of(context);
    final c = store.customerById(widget.customerId);
    final debit = c.debitBalance;

    return Scaffold(
      appBar: AppBar(title: const Text('Thu tiền')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          Text(c.name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          if (widget.orderCode != null)
            Text('Theo đơn ${widget.orderCode}', style: const TextStyle(color: Color(0xFF6B7280))),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Công nợ hiện tại', style: TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
                  Text(formatVndFull(debit), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: sky)),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          const Text('Số tiền thu', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: [
              ActionChip(label: const Text('Toàn bộ'), onPressed: () => setState(() => controller.text = '$debit')),
              ActionChip(
                label: const Text('50%'),
                onPressed: () => setState(() => controller.text = '${(debit / 2).round()}'),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            keyboardType: TextInputType.number,
            controller: controller,
            decoration: InputDecoration(
              suffixText: '₫',
              filled: true,
              fillColor: Colors.white,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
            ),
          ),
          const SizedBox(height: 16),
          const Text('Hình thức', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: methods.map((m) {
              return ChoiceChip(
                label: Text(m),
                selected: method == m,
                onSelected: (_) => setState(() => method = m),
                selectedColor: sky.withValues(alpha: 0.18),
              );
            }).toList(),
          ),
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: debit <= 0
                ? null
                : () {
                    store.collectPayment(
                      customerId: widget.customerId,
                      amount: amount,
                      method: method,
                      orderCode: widget.orderCode,
                    );
                    if (!context.mounted) return;
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Đã ghi nhận thu tiền (chờ đồng bộ).')),
                    );
                    Navigator.of(context).pop();
                  },
            icon: const Icon(Icons.check),
            label: const Text('Xác nhận thu tiền'),
          ),
        ],
      ),
    );
  }
}
