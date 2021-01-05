const express = require('express');
const router = express.Router();

router.get('/', (req, res, next) => {
  res.status(200).json({
    "status": 200,
    "message": "server siap digunakan",
    "timestamp": req.requestTime
  });
});

module.exports = router;