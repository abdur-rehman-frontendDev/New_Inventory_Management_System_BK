const { z, text } = require("./common");

const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(120);

const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters")
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/\d/, "Password must contain a number");

const role = z.enum(["admin", "manager", "staff"]);

module.exports = {
  signup: z.object({ name: text(80).min(2, "Name must be at least 2 characters"), email, password }),
  login: z.object({ email, password: z.string().min(1, "Password is required").max(200) }),
  createUser: z.object({ name: text(80).min(2, "Name must be at least 2 characters"), email, password, role }),
  setRole: z.object({ role }),
  setActive: z.object({ active: z.boolean() }),
  changePassword: z.object({ currentPassword: z.string().min(1, "Current password is required"), newPassword: password }),
  updateProfile: z.object({
    name: text(80).min(2).optional(),
    ProfilePic: z
      .string()
      .max(8 * 1024 * 1024, "Image is too large")
      .regex(/^data:image\/(png|jpe?g|webp|gif);base64,/i, "Profile picture must be a PNG, JPG, WEBP or GIF image")
      .optional(),
  }),
};
