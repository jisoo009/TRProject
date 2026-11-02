function requireLogin(req, res, next) {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({
            message: "로그인이 필요합니다."
        })
    }
    next();
}

module.exports = requireLogin;