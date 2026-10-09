import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      unique: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    displayName: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "",
    },
    notificationPreferences: {
      browserNotifications: {
        type: Boolean,
        default: false,
      },
      taskReminders: {
        type: Boolean,
        default: false,
      },
    },
    deletionRequestedAt: {
      type: Date,
      default: null,
      select: false,
    },
    tokenVersion: {
      type: Number,
      default: 0,
      select: false,
    },
  },
  { timestamps: true }
);

userSchema.set("toJSON", {
  transform(_document, returned) {
    delete returned.passwordHash;
    delete returned.tokenVersion;
    delete returned.__v;
    return returned;
  },
});

const User = mongoose.model("User", userSchema);

export default User;
