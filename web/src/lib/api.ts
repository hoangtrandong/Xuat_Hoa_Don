const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
const renderApiUrl = "http://localhost:8000/api/v1";

export const API_URL = configuredApiUrl && !configuredApiUrl.includes("localhost")
  ? configuredApiUrl
  : renderApiUrl;
