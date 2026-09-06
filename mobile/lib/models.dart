enum VisitStatus { notStarted, checkedIn, completed }

enum SyncKind { visit, order, payment }

enum QueueStatus { pending, syncing, synced, failed }

class Customer {
  Customer({
    required this.id,
    required this.code,
    required this.name,
    required this.type,
    required this.tier,
    required this.phone,
    required this.contactName,
    required this.address,
    required this.district,
    required this.routeCode,
    required this.routeName,
    required this.salesRep,
    required this.status,
    required this.debitBalance,
    required this.totalSpend,
  });

  final String id;
  final String code;
  final String name;
  final String type;
  final String tier;
  final String phone;
  final String contactName;
  final String address;
  final String district;
  final String routeCode;
  final String routeName;
  final String salesRep;
  final String status;
  int debitBalance;
  final int totalSpend;
}

class Product {
  const Product({
    required this.code,
    required this.name,
    required this.unit,
    required this.price,
    required this.category,
    required this.stock,
    required this.active,
  });

  final String code;
  final String name;
  final String unit;
  final int price;
  final String category;
  final int stock;
  final bool active;
}

class VisitRecord {
  VisitRecord({
    required this.id,
    required this.customerId,
    this.checkInAt,
    this.checkOutAt,
    this.lat = 10.7769,
    this.lng = 106.7009,
    this.note = '',
    this.status = VisitStatus.notStarted,
  });

  final String id;
  final String customerId;
  DateTime? checkInAt;
  DateTime? checkOutAt;
  double lat;
  double lng;
  String note;
  VisitStatus status;
}

class OrderLine {
  OrderLine({
    required this.productCode,
    required this.productName,
    required this.unit,
    required this.price,
    required this.quantity,
  });

  final String productCode;
  final String productName;
  final String unit;
  final int price;
  int quantity;

  int get lineTotal => price * quantity;
}

class SalesOrder {
  SalesOrder({
    required this.id,
    required this.code,
    required this.customerId,
    required this.customerName,
    required this.lines,
    required this.total,
    required this.createdAt,
    this.note = '',
  });

  final String id;
  final String code;
  final String customerId;
  final String customerName;
  final List<OrderLine> lines;
  final int total;
  final DateTime createdAt;
  final String note;
}

class PaymentRecord {
  PaymentRecord({
    required this.id,
    required this.customerId,
    required this.customerName,
    required this.amount,
    required this.method,
    required this.createdAt,
    this.orderCode,
  });

  final String id;
  final String customerId;
  final String customerName;
  final int amount;
  final String method;
  final DateTime createdAt;
  final String? orderCode;
}

class SyncItem {
  SyncItem({
    required this.id,
    required this.kind,
    required this.title,
    required this.subtitle,
    required this.createdAt,
    this.status = QueueStatus.pending,
  });

  final String id;
  final SyncKind kind;
  final String title;
  final String subtitle;
  final DateTime createdAt;
  QueueStatus status;
}
