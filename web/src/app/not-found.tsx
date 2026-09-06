import Link from "next/link";

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <div className="text-6xl font-bold text-gray-200">404</div>
      <p className="text-gray-500">Trang không tồn tại</p>
      <Link href="/" className="px-4 py-2 bg-sky-500 text-white rounded-lg text-sm hover:bg-sky-600">
        Về Dashboard
      </Link>
    </div>
  );
}