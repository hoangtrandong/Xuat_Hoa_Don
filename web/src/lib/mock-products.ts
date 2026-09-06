// src/lib/mock-products.ts

export const categories = [
  { id: "C1", name: "Chăm sóc tóc", productCount: 15, color: "bg-sky-50 text-sky-600", description: "Dầu gội, dầu xả, sản phẩm tạo kiểu tóc." },
  { id: "C2", name: "Giặt tẩy", productCount: 20, color: "bg-purple-50 text-purple-600", description: "Bột giặt, nước giặt, nước xả vải." },
  { id: "C3", name: "Vệ sinh nhà", productCount: 12, color: "bg-amber-50 text-amber-600", description: "Nước lau sàn, chất tẩy rửa, chăm sóc nhà cửa." },
  { id: "C4", name: "Thực phẩm", productCount: 35, color: "bg-emerald-50 text-emerald-600", description: "Bánh kẹo, mì ăn liền, gia vị, đồ hộp." },
  { id: "C5", name: "Đồ uống", productCount: 28, color: "bg-rose-50 text-rose-600", description: "Nước ngọt, bia, nước suối, sữa, trà." },
];

export const products = [
  { id: "P001", code: "SKU-001", name: "Dầu gội Clear 650ml", category: "Chăm sóc tóc", supplier: "Unilever", unit: "Chai", price: 165000, costPrice: 115000, stock: 120, status: "active", image: "" },
  { id: "P002", code: "SKU-002", name: "Dầu xả Sunsilk 320ml", category: "Chăm sóc tóc", supplier: "Unilever", unit: "Chai", price: 85000, costPrice: 60000, stock: 45, status: "active", image: "" },
  { id: "P003", code: "SKU-003", name: "Omo Matic 3kg", category: "Giặt tẩy", supplier: "Unilever", unit: "Túi", price: 195000, costPrice: 145000, stock: 85, status: "active", image: "" },
  { id: "P004", code: "SKU-004", name: "Comfort Xanh 800ml", category: "Giặt tẩy", supplier: "Unilever", unit: "Chai", price: 75000, costPrice: 55000, stock: 15, status: "active", image: "" },
  { id: "P005", code: "SKU-005", name: "Vim Diệt Khuẩn 900ml", category: "Vệ sinh nhà", supplier: "Unilever", unit: "Chai", price: 42000, costPrice: 30000, stock: 210, status: "active", image: "" },
  { id: "P006", code: "SKU-006", name: "Nước lau sàn Sunlight 1kg", category: "Vệ sinh nhà", supplier: "Unilever", unit: "Chai", price: 38000, costPrice: 28000, stock: 150, status: "active", image: "" },
  { id: "P007", code: "SKU-007", name: "Bánh quy Cosy 300g", category: "Thực phẩm", supplier: "Việt Đại", unit: "Hộp", price: 45000, costPrice: 32000, stock: 320, status: "active", image: "" },
  { id: "P008", code: "SKU-008", name: "Kẹo dẻo Chupa Chups 150g", category: "Thực phẩm", supplier: "Việt Đại", unit: "Gói", price: 25000, costPrice: 18000, stock: 500, status: "active", image: "" },
  { id: "P009", code: "SKU-009", name: "Mì Hảo Hảo Tôm Chua Cay", category: "Thực phẩm", supplier: "Cầu Đỏ", unit: "Thùng", price: 110000, costPrice: 90000, stock: 420, status: "active", image: "" },
  { id: "P010", code: "SKU-010", name: "Nước mắm Nam Ngư 750ml", category: "Thực phẩm", supplier: "Cầu Đỏ", unit: "Chai", price: 48000, costPrice: 35000, stock: 180, status: "active", image: "" },
  { id: "P011", code: "SKU-011", name: "Bia Heineken 330ml (Thùng 24)", category: "Đồ uống", supplier: "Hayat", unit: "Thùng", price: 420000, costPrice: 380000, stock: 8, status: "active", image: "" },
  { id: "P012", code: "SKU-012", name: "Nước ngọt Coca-Cola 390ml", category: "Đồ uống", supplier: "Hayat", unit: "Lốc", price: 45000, costPrice: 35000, stock: 150, status: "active", image: "" },
  { id: "P013", code: "SKU-013", name: "Sữa tươi Vinamilk 100% 180ml", category: "Đồ uống", supplier: "Vinamilk", unit: "Lốc", price: 32000, costPrice: 25000, stock: 300, status: "active", image: "" },
  { id: "P014", code: "SKU-014", name: "Sữa chua Vinamilk Có Đường", category: "Thực phẩm", supplier: "Vinamilk", unit: "Lốc", price: 28000, costPrice: 22000, stock: 120, status: "active", image: "" },
  { id: "P015", code: "SKU-015", name: "Nước suối Aquafina 500ml", category: "Đồ uống", supplier: "Hayat", unit: "Chai", price: 5000, costPrice: 3500, stock: 800, status: "active", image: "" },
  { id: "P016", code: "SKU-016", name: "Sữa đặc Ông Thọ 380g", category: "Thực phẩm", supplier: "Vinamilk", unit: "Lon", price: 24000, costPrice: 19000, stock: 12, status: "active", image: "" },
  { id: "P017", code: "SKU-017", name: "Sữa hạt TH True Nut 180ml", category: "Đồ uống", supplier: "Khác", unit: "Lốc", price: 48000, costPrice: 38000, stock: 0, status: "inactive", image: "" },
  { id: "P018", code: "SKU-018", name: "Trà Ô Long Tea+ Plus 455ml", category: "Đồ uống", supplier: "Hayat", unit: "Chai", price: 10000, costPrice: 7000, stock: 250, status: "active", image: "" },
  { id: "P019", code: "SKU-019", name: "Bột giặt Surf 5.5kg", category: "Giặt tẩy", supplier: "Unilever", unit: "Túi", price: 185000, costPrice: 140000, stock: 40, status: "active", image: "" },
  { id: "P020", code: "SKU-020", name: "Tương ớt Chinsu 250g", category: "Thực phẩm", supplier: "Cầu Đỏ", unit: "Chai", price: 15000, costPrice: 11000, stock: 350, status: "active", image: "" },
];

export const priceLists = [
  { id: "PL1", name: "Bảng giá Bán lẻ", effectiveDate: "2026-03-01", customerType: "Tất cả", note: "Áp dụng cho khách mua lẻ" },
  { id: "PL2", name: "Bảng giá Đại lý (Tier A)", effectiveDate: "2026-06-01", customerType: "Đại lý Tier A", note: "Chiết khấu 15% so với giá bán lẻ" },
  { id: "PL3", name: "Bảng giá Kênh HORECA", effectiveDate: "2026-08-01", customerType: "Nhà hàng / Khách sạn", note: "Chiết khấu 8% + hỗ trợ chiêu thị" },
];

export interface PriceListItem {
  productCode: string;
  productName: string;
  unit: string;
  basePrice: number;
  price: number;
  status: "active" | "inactive";
}

export interface PriceList {
  id: string;
  name: string;
  effectiveDate: string;
  customerType: string;
  note: string;
  items: PriceListItem[];
}

export const priceListItems: PriceList[] = priceLists.map((pl) => ({
  ...pl,
  items: products.map((p): PriceListItem => {
    const factor = pl.id === "PL1" ? 1 : pl.id === "PL2" ? 0.85 : 0.92;
    return {
      productCode: p.code,
      productName: p.name,
      unit: p.unit,
      basePrice: p.price,
      price: Math.round(p.price * factor),
      status: p.status as "active" | "inactive",
    };
  }),
}));