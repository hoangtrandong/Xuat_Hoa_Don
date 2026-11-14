# Standard Form and Modal Design Rule

Mọi modal tạo form, cấu hình, popup nhập liệu trong dự án phải tuân theo cấu trúc chuẩn của `web/src/components/sales/CreateOrderForm.tsx`:
1. **Header**: Nền `bg-[#14263d]`, icon màu đỏ (`text-red-500`), chữ in hoa `text-xs font-bold uppercase text-white`, nút tắt `hover:bg-white/10`.
2. **Inputs**: `w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100`.
3. **Labels**: `text-[10px] font-semibold text-slate-600 block mb-0.5`.
4. **Sections**: `border-b border-sky-100 bg-sky-50/60 px-3 py-2 text-[11px] font-bold text-sky-800`.
5. **Table**: thead `bg-slate-100 text-[10px] font-semibold text-slate-600`, tr `even:bg-amber-50/40 hover:bg-sky-50/50`.
6. **Footer**: Nền `border-t border-slate-300 bg-slate-100 px-3 py-2`, nút Đóng đỏ `bg-red-700 hover:bg-red-800`, nút Lưu xanh `bg-sky-600 hover:bg-sky-700 text-white font-semibold`.
