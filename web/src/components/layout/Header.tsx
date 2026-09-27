"use client";

import { Bell, Search, Menu as MenuIcon, LogOut } from "lucide-react";

interface HeaderProps {
  onMobileMenuOpen: () => void;
  onLogout: () => void;
  username: string;
}

export default function Header({ onMobileMenuOpen, onLogout, username }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 lg:px-6">
      {/* Left: Mobile menu + Search */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMobileMenuOpen}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 lg:hidden"
        >
          <MenuIcon size={20} />
        </button>
        <div className="relative hidden sm:block">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            placeholder="Tìm kiếm..."
            className="pl-9 pr-4 py-2 text-sm bg-gray-100 rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:bg-white transition-colors"
          />
        </div>
      </div>

      {/* Right: Notifications + User */}
      <div className="flex items-center gap-2">
        <button className="relative p-2 rounded-lg hover:bg-gray-100 text-gray-500">
          <Bell size={20} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
        </button>

        <div className="flex items-center gap-2 pl-2">
          <div className="w-8 h-8 rounded-full bg-sky-500 flex items-center justify-center">
            <span className="text-white text-sm font-semibold">
              {username.slice(0, 2).toUpperCase()}
            </span>
          </div>
          <div className="hidden sm:block text-left">
            <p className="text-sm font-medium text-gray-800 leading-none">{username}</p>
            <p className="text-xs text-gray-400 mt-0.5">Đã đăng nhập</p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="ml-1 rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
            aria-label="Đăng xuất"
            title="Đăng xuất"
          >
            <LogOut size={17} />
          </button>
        </div>
      </div>
    </header>
  );
}
