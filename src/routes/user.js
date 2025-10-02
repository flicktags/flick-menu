// server/routes/user.js
import { Router } from 'express';
import { verifyFirebaseToken } from '../middlewares/authMiddleware.js'
import Vendor from '../models/Vendor.js';

const router = Router();

/**
 * GET /api/user/me
 * Header: Authorization: Bearer <id_token>
 * Response: { user: {uid, email}, vendor: {...} | null }
 */
router.get('/me', verifyFirebaseToken, async (req, res) => {
  try {
    const { uid, email } = req.user;
    const vendor = await Vendor.findOne({ userId: uid }).lean();

    return res.status(200).json({
      user: { uid, email: email ?? null },
      vendor: vendor ?? null,
    });
  } catch (e) {
    console.error('GET /api/user/me error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

export default router;
