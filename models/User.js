const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: [true, 'Please provide full name'],
    maxlength: 50
  },
  email: {
    type: String,
    required: [true, 'Please provide email'],
    unique: true,
    lowercase: true,
    match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please provide valid email']
  },
  leftOffId: {
    type: String,
    unique: true,
    required: true
  },
  verificationCode: {
    type: String,
    default: null
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  tier: {
    type: String,
    enum: ['TRIAL', 'FREE', 'PREMIUM'],
    default: 'TRIAL'
  },
  trialStartDate: {
    type: Date,
    default: null
  },
  trialEndDate: {
    type: Date,
    default: null
  },
  isInTrial: {
    type: Boolean,
    default: true
  },
  isPremium: {
    type: Boolean,
    default: false
  },
  subscriptionStatus: {
    type: String,
    enum: ['active', 'inactive', 'cancelled'],
    default: 'active'
  },
  remindersSent: {
    type: [String],
    default: []
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Hash verification code before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('verificationCode')) {
    next();
  }

  // Don't hash for now, we need plain text to compare
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('User', userSchema);
