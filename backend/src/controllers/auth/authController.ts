import { Request, Response } from "express";
import * as authService from "../../services/auth/authService.js";
import * as userService from "../../services/users/userService.js";

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN!;

export async function login(_req: Request, res: Response) {
  try {
    console.log('🔐 Iniciando login con Spotify...');
    const loginUrl = authService.getLoginUrl();
    console.log('✅ URL de Spotify generada, redirigiendo:', loginUrl);
    res.redirect(loginUrl);
  } catch (error: any) {
    console.error('❌ Error al iniciar login con Spotify:', error);
    console.error('❌ Stack trace:', error?.stack);
    res.status(500).json({ 
      error: "Failed to initiate login",
      details: error?.message || error?.toString() 
    });
  }
}

export async function callback(req: Request, res: Response) {
  try {
    const { code, error: spotifyError } = req.query;

    // Si Spotify devuelve un error, redirigir con el error
    if (spotifyError) {
      console.error('❌ Error de Spotify:', spotifyError);
      return res.redirect(`${FRONTEND_ORIGIN}/login?error=spotify_error&details=${encodeURIComponent(spotifyError as string)}`);
    }

    if (!code) {
      console.error('❌ No se recibió el código de autorización');
      return res.redirect(`${FRONTEND_ORIGIN}/login?error=no_code`);
    }

    console.log('✅ Código recibido, intercambiando por tokens...');
    const tokenData = await authService.exchangeCodeForTokens(code as string);

    console.log('✅ Tokens obtenidos, obteniendo perfil de usuario...');
    // Obtener el perfil del usuario desde Spotify
    const profile = await authService.getUserProfile(tokenData.access_token);

    console.log('✅ Perfil obtenido, creando/actualizando usuario en BD...');
    // Crear o devolver el usuario existente en la base de datos
    const user = await userService.createUser({
      spotify_id: profile.id,
      email: profile.email,
      country: profile.country,
      name: profile.display_name,
    });

    const userId = (user as any)?._id?.toString?.() ?? (user as any)?.id ?? "";
    console.log('✅ Usuario creado/actualizado, redirigiendo al frontend...');
    // Redirigir a una página que guarde los tokens y cierre la ventana
    // Esta página guardará los tokens en localStorage y cerrará la ventana automáticamente
    const redirectUrl = `${FRONTEND_ORIGIN}/login?access_token=${tokenData.access_token}&refresh_token=${tokenData.refresh_token}${userId ? `&user_id=${encodeURIComponent(userId)}` : ""}&close=true`;
    res.redirect(redirectUrl);
  } catch (error: any) {
    console.error('❌ Error en callback de Spotify:', error);
    console.error('❌ Stack trace:', error?.stack);
    
    // Incluir más detalles del error en la redirección
    const errorMessage = error?.message || error?.toString() || 'unknown_error';
    const errorDetails = errorMessage.length > 200 ? errorMessage.substring(0, 200) + '...' : errorMessage;
    
    console.error('❌ Redirigiendo con error:', errorDetails);
    res.redirect(`${FRONTEND_ORIGIN}/login?error=auth_failed&details=${encodeURIComponent(errorDetails)}`);
  }
}

export async function getProfile(req: Request, res: Response) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const accessToken = authHeader.substring(7);
    const profile = await authService.getUserProfile(accessToken);
    return res.json(profile);
  } catch (error: any) {
    // Si el token expiró, intentar renovarlo automáticamente
    if (error.message?.includes("expired") || error.message?.includes("401")) {
      return res.status(401).json({ 
        error: "Token expired", 
        code: "TOKEN_EXPIRED",
        message: "El token de acceso ha expirado. Por favor, inicia sesión nuevamente."
      });
    }
    res.status(401).json({ error: "Invalid token" });
  }
}

export async function logout(_req: Request, res: Response) {
  try {
    res.json({ message: "Logged out successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to logout" });
  }
}

export async function loginWithEmailPassword(req: Request, res: Response) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email y contraseña son requeridos" });
    }

    // Buscar usuario por email
    const User = (await import("../../models/user.js")).default;
    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    // Verificar contraseña (comparación simple por ahora, en producción usar bcrypt)
    if (user.password !== password) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    // Generar tokens simples (en producción usar JWT)
    const accessToken = `token_${user._id}_${Date.now()}`;
    const refreshToken = `refresh_${user._id}_${Date.now()}`;

    const userId = (user as any)?._id?.toString?.() ?? (user as any)?.id ?? "";

    res.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      user_id: userId,
      user: {
        id: userId,
        email: user.email,
        name: user.name,
        spotify_id: user.spotify_id
      }
    });
  } catch (error) {
    console.error("Error en login:", error);
    res.status(500).json({ error: "Error al iniciar sesión" });
  }
}

export async function checkUserRegistration(req: Request, res: Response) {
  try {
    const { email, spotify_token } = req.body;

    const User = (await import("../../models/user.js")).default;
    let user = null;

    // Primero verificar si está registrado en la BD (por email) - mismo método que loginWithEmailPassword
    if (email) {
      // Buscar usuario por email - mismo método que loginWithEmailPassword (línea 79)
      user = await User.findOne({ email });
      if (user) {
        return res.json({ 
          registered: true, 
          method: 'email',
          user: {
            id: (user as any)?._id?.toString?.() ?? (user as any)?.id ?? "",
            email: user.email,
            name: user.name,
            spotify_id: user.spotify_id
          }
        });
      }
    }

    // Si no está en la BD, verificar si está registrado mediante Spotify - mismo método que callback
    // Solo verificar con Spotify si el token no es un token generado por email/password
    // Los tokens de email/password empiezan con "token_", los de Spotify son diferentes
    if (spotify_token && !spotify_token.startsWith('token_')) {
      try {
        // Obtener perfil de Spotify usando el token - mismo método que callback (línea 27)
        const spotifyProfile = await authService.getUserProfile(spotify_token);
        if (spotifyProfile && spotifyProfile.id) {
          // Buscar usuario por spotify_id - mismo método que getUserBySpotifyId
          user = await User.findOne({ spotify_id: spotifyProfile.id });
          if (user) {
            return res.json({ 
              registered: true, 
              method: 'spotify',
              user: {
                id: (user as any)?._id?.toString?.() ?? (user as any)?.id ?? "",
                email: user.email,
                name: user.name,
                spotify_id: user.spotify_id
              }
            });
          }
        }
      } catch (error) {
        // Token de Spotify inválido o expirado - no es un error crítico, simplemente no está registrado con Spotify
        console.log("Token de Spotify inválido o expirado:", error);
      }
    }

    // No está registrado en ninguna de las dos formas
    return res.json({ registered: false });
  } catch (error) {
    console.error("Error al verificar registro:", error);
    res.status(500).json({ error: "Error al verificar registro" });
  }
}
export async function refreshToken(req: Request, res: Response) {
  try {
    const { refresh_token } = req.body;
    
    if (!refresh_token) {
      return res.status(400).json({ error: "Refresh token is required" });
    }

    const tokenData = await authService.refreshAccessToken(refresh_token);
    
    res.json({
      access_token: tokenData.access_token,
      expires_in: tokenData.expires_in,
      token_type: tokenData.token_type
    });
  } catch (error: any) {
    console.error('❌ Error al refrescar el token:', error);
    res.status(401).json({ 
      error: "Failed to refresh token",
      message: "El refresh token es inválido o ha expirado. Por favor, inicia sesión nuevamente."
    });
  }
}
