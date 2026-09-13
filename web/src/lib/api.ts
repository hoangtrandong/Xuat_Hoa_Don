const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
const renderApiUrl = "https://dms-project-250u.onrender.com/api/v1";

// Ưu tiên URL đã cấu hình trong môi trường (localhost khi dev, domain khi deploy).
// Chỉ fallback về Render khi không có cấu hình.
export const API_URL = configuredApiUrl || renderApiUrl;
