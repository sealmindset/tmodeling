const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const redis = require('redis');

// Redis client setup
const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = process.env.REDIS_PORT || 6379;

const client = redis.createClient({
  socket: {
    host: redisHost,
    port: redisPort,
  },
  password: process.env.REDIS_PASSWORD,
});

client.on('error', (err) => {
  console.error('Redis error: ', err);
});

client
  .connect()
  .then(() => console.log('Connected to Redis successfully!'))
  .catch(console.error);

module.exports = (app) => {
  // Passport session setup
  passport.serializeUser((user, done) => {
    done(null, user.email); // Serialize by email
  });

  passport.deserializeUser(async (email, done) => {
    try {
      const user = await client.hGetAll(`user:${email}`);
      if (Object.keys(user).length === 0) return done(null, false); // No user found
      done(null, user);
    } catch (err) {
      done(err, null);
    }
  });

  // Check if user is registered
  const checkUserRegistration = async (profile) => {
    const userId = `user:${profile.emails[0].value}`;
    const userExists = await client.exists(userId);
    return userExists;
  };

  // Use the Google strategy within Passport.
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: 'https://tmodeling.onrender.com/auth/google/callback',
      },
      async function (accessToken, refreshToken, profile, done) {
        const userExists = await checkUserRegistration(profile);
        if (!userExists) {
          return done(null, false, { message: 'Please register before using Google login.' });
        }
        const user = await client.hGetAll(`user:${profile.emails[0].value}`);
        return done(null, user);
      }
    )
  );

  // Use the GitHub strategy within Passport.
  passport.use(
    new GitHubStrategy(
      {
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL: 'https://tmodeling.onrender.com/auth/github/callback',
      },
      async function (accessToken, refreshToken, profile, done) {
        const userExists = await checkUserRegistration(profile);
        if (!userExists) {
          return done(null, false, { message: 'Please register before using GitHub login.' });
        }
        const user = await client.hGetAll(`user:${profile.emails[0].value}`);
        return done(null, user);
      }
    )
  );

  // Initialize Passport and restore authentication state, if any, from the session.
  app.use(passport.initialize());
  app.use(passport.session());

  // Routes for Google authentication
  app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
  );

  app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login' }),
    (req, res) => {
      if (!req.user) {
        res.redirect('/register');
      } else {
        res.redirect('/');
      }
    }
  );

  // Routes for GitHub authentication
  app.get('/auth/github',
    passport.authenticate('github', { scope: ['user:email'] })
  );

  app.get('/auth/github/callback',
    passport.authenticate('github', { failureRedirect: '/login' }),
    (req, res) => {
      if (!req.user) {
        res.redirect('/register');
      } else {
        res.redirect('/');
      }
    }
  );

  // Logout route
  app.get('/logout', (req, res) => {
    req.logout((err) => {
      if (err) {
        return next(err);
      }
      res.redirect('/');
    });
  });
};
