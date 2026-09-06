import 'package:flutter/material.dart';

import 'mock_data.dart';
import 'models.dart';

class AppStore extends ChangeNotifier {
  AppStore._() {
    customers = List<Customer>.from(seedCustomers);
    products = List<Product>.from(seedProducts);
  }

  static final AppStore instance = AppStore._();

  late final List<Customer> customers;
  late final List<Product> products;
  final Map<String, VisitRecord> visits = {};
  final List<SalesOrder> orders = [];
  final List<PaymentRecord> payments = [];
  final List<SyncItem> queue = [];

  bool offline = true;
  bool syncing = false;
  int _seq = 1;

  String get nextId {
    final id = _seq.toString().padLeft(3, '0');
    _seq += 1;
    return id;
  }

  int get visitedCount =>
      visits.values.where((v) => v.status != VisitStatus.notStarted).length;

  int get completedCount =>
      visits.values.where((v) => v.status == VisitStatus.completed).length;

  int get pendingSyncCount =>
      queue.where((q) => q.status == QueueStatus.pending || q.status == QueueStatus.failed).length;

  int get todayOrderTotal => orders.fold(0, (s, o) => s + o.total);

  Customer customerById(String id) => customers.firstWhere((c) => c.id == id);

  VisitRecord visitOf(String customerId) {
    return visits.putIfAbsent(
      customerId,
      () => VisitRecord(id: 'VT-$nextId', customerId: customerId),
    );
  }

  List<SalesOrder> ordersOf(String customerId) =>
      orders.where((o) => o.customerId == customerId).toList();

  void setOffline(bool value) {
    offline = value;
    notifyListeners();
  }

  void checkIn(String customerId, {String note = ''}) {
    final visit = visitOf(customerId);
    final hash = customerId.hashCode;
    visit.checkInAt = DateTime.now();
    visit.status = VisitStatus.checkedIn;
    visit.note = note;
    visit.lat = 10.7769 + (hash % 80) / 10000;
    visit.lng = 106.7009 + (hash % 60) / 10000;
    _enqueue(
      kind: SyncKind.visit,
      title: 'Check-in ${customerById(customerId).name}',
      subtitle: 'GPS ${visit.lat.toStringAsFixed(4)}, ${visit.lng.toStringAsFixed(4)}',
    );
    notifyListeners();
  }

  void completeVisit(String customerId, {String note = ''}) {
    final visit = visitOf(customerId);
    visit.checkOutAt = DateTime.now();
    visit.status = VisitStatus.completed;
    if (note.isNotEmpty) visit.note = note;
    _enqueue(
      kind: SyncKind.visit,
      title: 'Hoàn tất viếng ${customerById(customerId).name}',
      subtitle: visit.note.isEmpty ? 'Không ghi chú' : visit.note,
    );
    notifyListeners();
  }

  SalesOrder placeOrder({
    required String customerId,
    required List<OrderLine> lines,
    String note = '',
  }) {
    final customer = customerById(customerId);
    final total = lines.fold(0, (s, l) => s + l.lineTotal);
    final seq = nextId;
    final order = SalesOrder(
      id: 'ORD-$seq',
      code: 'DH-M-$seq',
      customerId: customerId,
      customerName: customer.name,
      lines: lines,
      total: total,
      createdAt: DateTime.now(),
      note: note,
    );
    orders.insert(0, order);
    customer.debitBalance += total;
    _enqueue(
      kind: SyncKind.order,
      title: 'Đơn ${order.code}',
      subtitle: '${customer.name} · ${lines.length} SKU',
    );
    notifyListeners();
    return order;
  }

  PaymentRecord collectPayment({
    required String customerId,
    required int amount,
    required String method,
    String? orderCode,
  }) {
    final customer = customerById(customerId);
    final paid = amount.clamp(0, customer.debitBalance);
    customer.debitBalance -= paid;
    final payment = PaymentRecord(
      id: 'PAY-$nextId',
      customerId: customerId,
      customerName: customer.name,
      amount: paid,
      method: method,
      createdAt: DateTime.now(),
      orderCode: orderCode,
    );
    payments.insert(0, payment);
    _enqueue(
      kind: SyncKind.payment,
      title: 'Thu ${customer.name}',
      subtitle: method,
    );
    notifyListeners();
    return payment;
  }

  Future<void> syncAll() async {
    if (offline || syncing) return;
    syncing = true;
    notifyListeners();
    final pending = queue
        .where((q) => q.status == QueueStatus.pending || q.status == QueueStatus.failed)
        .toList();
    for (final item in pending) {
      item.status = QueueStatus.syncing;
      notifyListeners();
      await Future<void>.delayed(const Duration(milliseconds: 450));
      item.status = QueueStatus.synced;
      notifyListeners();
    }
    syncing = false;
    notifyListeners();
  }

  void retry(SyncItem item) {
    if (item.status == QueueStatus.failed) {
      item.status = QueueStatus.pending;
      notifyListeners();
    }
  }

  void _enqueue({
    required SyncKind kind,
    required String title,
    required String subtitle,
  }) {
    queue.insert(
      0,
      SyncItem(
        id: 'SYNC-$nextId',
        kind: kind,
        title: title,
        subtitle: subtitle,
        createdAt: DateTime.now(),
      ),
    );
  }
}

class AppStoreScope extends InheritedNotifier<AppStore> {
  const AppStoreScope({
    super.key,
    required AppStore store,
    required super.child,
  }) : super(notifier: store);

  static AppStore of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<AppStoreScope>();
    assert(scope != null, 'AppStoreScope not found');
    return scope!.notifier!;
  }
}
