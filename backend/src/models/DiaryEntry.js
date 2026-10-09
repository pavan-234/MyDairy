import mongoose from "mongoose";

export const diaryMoods = [
  "HAPPY",
  "GOOD",
  "NEUTRAL",
  "SAD",
  "ANGRY",
  "EXCITED",
];

const formattingSchema = new mongoose.Schema(
  {
    fontFamily: {
      type: String,
      enum: ["Arial", "Georgia", "Times New Roman", "Courier New"],
      default: "Georgia",
    },
    fontSize: {
      type: Number,
      min: 12,
      max: 36,
      default: 18,
    },
    textColor: {
      type: String,
      default: "#292524",
    },
    textAlign: {
      type: String,
      enum: ["left", "center", "right"],
      default: "left",
    },
    pageStyle: {
      type: String,
      enum: ["plain", "ruled", "dotted", "dark"],
      default: "plain",
    },
    theme: {
      type: String,
      enum: ["light", "dark"],
      default: "light",
    },
  },
  { _id: false }
);

const imageAttachmentSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      match: /^[\da-f-]{36}$/,
    },
    originalName: {
      type: String,
      required: true,
      maxlength: 180,
    },
    mimeType: {
      type: String,
      enum: ["image/webp"],
      required: true,
    },
    size: {
      type: Number,
      required: true,
      min: 1,
    },
    width: {
      type: Number,
      required: true,
      min: 1,
    },
    height: {
      type: Number,
      required: true,
      min: 1,
    },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  { _id: false }
);

const diaryEntrySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      trim: true,
      maxlength: 160,
      default: "",
    },
    content: {
      type: String,
      maxlength: 100000,
      default: "",
    },
    date: {
      type: String,
      default: () => new Date().toISOString().slice(0, 10),
    },
    formatting: {
      type: formattingSchema,
      default: () => ({}),
    },
    mood: {
      type: String,
      enum: diaryMoods,
      default: "NEUTRAL",
    },
    tags: {
      type: [{ type: String, trim: true, lowercase: true, maxlength: 24 }],
      default: [],
      validate: {
        validator: (tags) => tags.length <= 10,
        message: "An entry can have at most 10 tags",
      },
    },
    isFavorite: {
      type: Boolean,
      default: false,
    },
    isDraft: {
      type: Boolean,
      default: false,
    },
    isLocked: {
      type: Boolean,
      default: false,
    },
    unlockVersion: {
      type: Number,
      default: 0,
      select: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    purgeRequestedAt: {
      type: Date,
      default: null,
      select: false,
    },
    images: {
      type: [imageAttachmentSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

diaryEntrySchema.index({ userId: 1, createdAt: -1, _id: -1 });
diaryEntrySchema.index({ userId: 1, updatedAt: -1, _id: -1 });
diaryEntrySchema.index({ userId: 1, date: 1, createdAt: 1, _id: 1 });
diaryEntrySchema.index({ userId: 1, isDraft: 1, date: 1 });
diaryEntrySchema.index({ userId: 1, mood: 1 });
diaryEntrySchema.index({ userId: 1, tags: 1 });
diaryEntrySchema.index({ userId: 1, isFavorite: 1 });
diaryEntrySchema.index({ userId: 1, isLocked: 1, deletedAt: 1 });
diaryEntrySchema.index({ userId: 1, deletedAt: 1, createdAt: -1, _id: -1 });
diaryEntrySchema.index({ userId: 1, deletedAt: -1, _id: -1 });
diaryEntrySchema.index(
  { userId: 1, title: "text", content: "text" },
  { weights: { title: 10, content: 1 }, name: "entry_text_search" }
);

const DiaryEntry = mongoose.model("DiaryEntry", diaryEntrySchema);

export default DiaryEntry;
