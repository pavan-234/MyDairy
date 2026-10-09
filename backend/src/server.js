import "dotenv/config";
import connectDatabase from "./config/database.js";
import { getAuthConfig } from "./config/auth.js";
import { createApp } from "./app.js";
import { connectReadCache } from "./services/readCache.js";

const port = process.env.PORT || 5000;

getAuthConfig();
await connectDatabase();
connectReadCache();

const app = createApp();
app.listen(port, () => {
  console.log(`MyDiary API is running at http://localhost:${port}`);
});
