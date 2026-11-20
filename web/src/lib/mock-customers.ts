// src/lib/mock-customers.ts
// Mock data: Khách hàng / Đại lý (Customer / Outlet)

export type CustomerType = "Đại lý" | "Cửa hàng" | "Nhà phân phối" | "HORECA";
export type CustomerTier = "A" | "B" | "C";

export interface Customer {
  id: string;
  code: string;
  name: string;
  type: CustomerType;
  tier: CustomerTier;
  citizenId?: string;
  taxCode?: string;
  contactName: string;
  email: string;
  address: string;
  district: string;
  status: "active" | "inactive";
  debitBalance: number;
  totalSpend: number;
  createdAt: string;
  staffCode?: string;
  staffName?: string;
  managerCode?: string;
  managerName?: string;
  // Multi-tenant: Nhà phân phối sở hữu mã KH
  distributorId?: string;
  distributorCode?: string;
  distributorName?: string;
  // Phase 2: cửa hàng & công ty quản lý
  storeId?: string;
  companyId?: string;
  storeCode?: string;
  storeName?: string;
  storeRoute?: string;
  companyCode?: string;
  companyName?: string;
}

export const customers: Customer[] = [
  { id: "KH-0001", code: "KH-0001", name: "Đại lý Phú Phong", type: "Đại lý", tier: "A", contactName: "Chị Mai", email: "mail.phuphong@gmail.com", address: "128 Nguyễn Thị Minh Khai", district: "Q.1", status: "active", debitBalance: 45000000, totalSpend: 1280000000, createdAt: "2021-03-15" },
  { id: "KH-0002", code: "KH-0002", name: "Cửa hàng An Khang 24h", type: "Cửa hàng", tier: "B", contactName: "Anh Hùng", email: "ankhang24h@yahoo.com", address: "45 Xô Viết Nghệ Tĩnh", district: "Bình Thạnh", status: "active", debitBalance: 8500000, totalSpend: 215000000, createdAt: "2022-07-20" },
  { id: "KH-0003", code: "KH-0003", name: "Nhà phân phối Minh Châu", type: "Nhà phân phối", tier: "A", contactName: "Chú Tám", email: "mc.distributor@minhchau.vn", address: "88 Quang Trung", district: "Gò Vấp", status: "active", debitBalance: 128000000, totalSpend: 2400000000, createdAt: "2020-01-10" },
  { id: "KH-0004", code: "KH-0004", name: "Tạp hóa Thu Hà", type: "Cửa hàng", tier: "C", contactName: "Cô Hà", email: "taphoathuha@gmail.com", address: "12 Lê Văn Sỹ", district: "Q.3", status: "active", debitBalance: 6200000, totalSpend: 96000000, createdAt: "2023-02-01" },
  { id: "KH-0005", code: "KH-0005", name: "Nhà hàng Hải Sản Biển Xanh", type: "HORECA", tier: "B", contactName: "Anh Cường", email: "cuong@bienxanh.vn", address: "250 Nguyễn Văn Linh", district: "Q.7", status: "active", debitBalance: 25000000, totalSpend: 540000000, createdAt: "2022-11-05" },
  { id: "KH-0006", code: "KH-0006", name: "Đại lý Thanh Tuyền", type: "Đại lý", tier: "B", contactName: "Chị Tuyền", email: "thanhtuyen.dl@gmail.com", address: "150 Hà Huy Tập", district: "Tân Phú", status: "active", debitBalance: 34000000, totalSpend: 780000000, createdAt: "2021-09-18" },
  { id: "KH-0007", code: "KH-0007", name: "Cửa hàng Trung Kiên", type: "Cửa hàng", tier: "B", contactName: "Anh Kiên", email: "trungkien.sh@gmail.com", address: "62 Nguyễn Thị Thập", district: "Q.7", status: "active", debitBalance: 0, totalSpend: 184000000, createdAt: "2023-05-22" },
  { id: "KH-0008", code: "KH-0008", name: "Tạp hóa Bé Na", type: "Cửa hàng", tier: "C", contactName: "Chị Na", email: "benataphoa@gmail.com", address: "9 Lê Đức Thọ", district: "Gò Vấp", status: "active", debitBalance: 3100000, totalSpend: 74000000, createdAt: "2024-01-15" },
  { id: "KH-0009", code: "KH-0009", name: "Nhà phân phối Sông Hồng", type: "Nhà phân phối", tier: "B", contactName: "Anh Hồng", email: "songhong.npp@gmail.com", address: "100 Quốc Lộ 13", district: "Bình Thạnh", status: "active", debitBalance: 96000000, totalSpend: 1650000000, createdAt: "2020-06-30" },
  { id: "KH-0010", code: "KH-0010", name: "Khách sạn Windsor Plaza", type: "HORECA", tier: "A", contactName: "Chị Linh", email: "vacancy@windsorplaza.vn", address: "18 An Dương Vương", district: "Q.5", status: "active", debitBalance: 41000000, totalSpend: 890000000, createdAt: "2021-05-09" },
  { id: "KH-0011", code: "KH-0011", name: "Đại lý Minh Tâm", type: "Đại lý", tier: "A", contactName: "Anh Tâm", email: "minhtam.daily@gmail.com", address: "55 Trường Chinh", district: "Tân Bình", status: "active", debitBalance: 52000000, totalSpend: 980000000, createdAt: "2021-01-25" },
  { id: "KH-0012", code: "KH-0012", name: "Cửa hàng Bách Hóa Xanh 3B", type: "Cửa hàng", tier: "A", contactName: "Anh Đức", email: "3b@bachtiepphoaluat.vn", address: "2 Quang Trung", district: "Gò Vấp", status: "active", debitBalance: 12000000, totalSpend: 310000000, createdAt: "2022-03-11" },
  { id: "KH-0013", code: "KH-0013", name: "Nhà hàng Bếp Việt", type: "HORECA", tier: "C", contactName: "Chị Hạnh", email: "bepviet@gmail.com", address: "33 Phan Đăng Lưu", district: "Tân Bình", status: "inactive", debitBalance: 9500000, totalSpend: 120000000, createdAt: "2023-08-02" },
  { id: "KH-0014", code: "KH-0014", name: "Nhà phân phối Thành Công", type: "Nhà phân phối", tier: "A", contactName: "Anh Thành", email: "thanhcong.npp@gmail.com", address: "200 Lê Trọng Tấn", district: "Tân Phú", status: "active", debitBalance: 145000000, totalSpend: 2100000000, createdAt: "2019-12-01" },
  { id: "KH-0015", code: "KH-0015", name: "Tạp hóa Minh Anh", type: "Cửa hàng", tier: "C", contactName: "Anh Minh", email: "minhanh.tp@gmail.com", address: "77 Nguyễn Kiệm", district: "Phú Nhuận", status: "active", debitBalance: 1800000, totalSpend: 58000000, createdAt: "2024-06-10" },
  { id: "KH-0016", code: "KH-0016", name: "Đại lý Hồng Phát", type: "Đại lý", tier: "B", contactName: "Chị Hồng", email: "hongphat.daily@gmail.com", address: "12 Bà Hom", district: "Hóc Môn", status: "active", debitBalance: 28000000, totalSpend: 640000000, createdAt: "2022-05-15" },
  { id: "KH-0017", code: "KH-0017", name: "Cửa hàng Xuân Thu", type: "Cửa hàng", tier: "B", contactName: "Anh Xuân", email: "xuanthu.sh@gmail.com", address: "99 Đặng Nguyên Cẩn", district: "Q.7", status: "active", debitBalance: 3500000, totalSpend: 165000000, createdAt: "2023-03-27" },
  { id: "KH-0018", code: "KH-0018", name: "Nhà hàng Sen Việt", type: "HORECA", tier: "B", contactName: "Chị Sen", email: "senviet.rest@gmail.com", address: "45 Võ Văn Tần", district: "Q.3", status: "active", debitBalance: 18500000, totalSpend: 420000000, createdAt: "2022-09-14" },
  { id: "KH-0019", code: "KH-0019", name: "Nhà phân phối Đại Nam", type: "Nhà phân phối", tier: "A", contactName: "Anh Nam", email: "dainam.npp@gmail.com", address: "350 Nguyễn Văn Cừ", district: "Q.8", status: "active", debitBalance: 210000000, totalSpend: 2600000000, createdAt: "2020-11-20" },
  { id: "KH-0020", code: "KH-0020", name: "Tạp hóa Hương Lan", type: "Cửa hàng", tier: "C", contactName: "Chị Lan", email: "huonglan.tp@gmail.com", address: "5 Thái Văn Lung", district: "Q.1", status: "active", debitBalance: 900000, totalSpend: 42000000, createdAt: "2024-09-05" },
  { id: "KH-0021", code: "KH-0021", name: "Đại lý Ánh Dương", type: "Đại lý", tier: "B", contactName: "Anh Dương", email: "anhduong.daily@gmail.com", address: "66 Quốc Lộ 22", district: "Hóc Môn", status: "active", debitBalance: 41000000, totalSpend: 720000000, createdAt: "2021-07-12" },
  { id: "KH-0022", code: "KH-0022", name: "Cửa hàng Hoàng Kim", type: "Cửa hàng", tier: "B", contactName: "Chị Kim", email: "hoangkim.sh@gmail.com", address: "18 Cách Mạng Tháng 8", district: "Q.3", status: "active", debitBalance: 5200000, totalSpend: 148000000, createdAt: "2022-12-01" },
];
