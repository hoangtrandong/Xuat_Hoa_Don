const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
const renderApiUrl = "https://dms-project-250u.onrender.com/api/v1";

export const API_URL = configuredApiUrl && !configuredApiUrl.includes("localhost")
  ? configuredApiUrl
  : renderApiUrl;
