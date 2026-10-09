import mongoose from "mongoose";

async function connectDatabase() {
  const mongoUri =
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    "mongodb://localhost:27017/diary";

  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB");
}

export default connectDatabase;
