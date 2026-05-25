export const mockUser = {
  id: 1,
  name: "Test Student",
  email: "student@example.com",
  password: "$2b$10$hashedpassword",
  role: "STUDENT",
  authToken: "student-token",
  passwordResetToken: null,
  passwordResetTokenExpiry: null,
  emailVerified: false,
  emailVerificationToken: null,
  emailVerificationTokenExpiry: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

export const mockAdmin = {
  ...mockUser,
  id: 2,
  name: "Admin User",
  email: "admin@example.com",
  role: "ADMIN",
  authToken: "admin-token",
};

export const mockCreator = {
  ...mockUser,
  id: 3,
  name: "Creator User",
  email: "creator@example.com",
  role: "CREATOR",
  authToken: "creator-token",
};

export const mockCourse = {
  id: 10,
  title: "Test Course",
  description: "A test course",
  authorId: mockCreator.id,
  isPaid: false,
  priceCents: null,
  currency: null,
  restrictedToAllowList: false,
  allowedEmails: [],
  author: { id: mockCreator.id, name: mockCreator.name, email: mockCreator.email },
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

export const mockPaidCourse = {
  ...mockCourse,
  id: 11,
  title: "Paid Course",
  isPaid: true,
  priceCents: 1999,
  currency: "usd",
};

export const mockAllowlistedCourse = {
  ...mockCourse,
  id: 12,
  title: "Restricted Course",
  restrictedToAllowList: true,
  allowedEmails: [{ email: "allowed@example.com" }],
};
