"use client";

import { useEffect } from "react";
import DeliveryRequestExcelCreate from "@/components/delivery-requests/DeliveryRequestExcelCreate";

export default function LegacyWarehouseDeliveryRequestsPage() {
  useEffect(() => {
    window.history.replaceState(null, "", "/admin/delivery-requests?tab=create");
  }, []);

  return <DeliveryRequestExcelCreate />;
}