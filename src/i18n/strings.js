/**
 * UI translation strings stored as RDF Turtle with language-tagged literals.
 *
 * Each string key is a paa: namespace IRI with rdfs:label predicates.
 * Key naming: {section}_{descriptor}
 *
 * Sections:
 *   nav_*   — navigation bar
 *   login_* — login page
 *   dash_*  — dashboard
 *   act_*   — activity page
 *   stor_*  — storage pages
 *   acl_*   — ACP editor
 *   prof_*  — profile editor
 *   apps_*  — app permissions (within settings)
 *   set_*   — settings page
 *   btn_*   — shared buttons
 *   auth_*  — OIDC authorize page
 *
 * Languages: en-US, fr, es, he, zh
 *
 * Pluralization: _one / _other suffixes.
 * Handler selects: t[count === 1 ? 'key_one' : 'key_other']
 *
 * ESCAPING RULES (critical for turtle-parser.js):
 *   - Use \\" for literal quotes inside strings (template literal → Turtle \" )
 *   - Chinese/Hebrew text containing ASCII " (0x22) must use \\"
 */
export const STRINGS_TURTLE = `
@prefix paa: <http://paa.pub/i18n#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

# ── Navigation ────────────────────────────────────────

paa:nav_dashboard rdfs:label "Dashboard"@en-US ;
    rdfs:label "Tableau de bord"@fr ;
    rdfs:label "Panel de control"@es ;
    rdfs:label "לוח בקרה"@he ;
    rdfs:label "仪表板"@zh .

paa:nav_profile rdfs:label "Profile"@en-US ;
    rdfs:label "Profil"@fr ;
    rdfs:label "Perfil"@es ;
    rdfs:label "פרופיל"@he ;
    rdfs:label "个人资料"@zh .

paa:nav_activity rdfs:label "Activity"@en-US ;
    rdfs:label "Activité"@fr ;
    rdfs:label "Actividad"@es ;
    rdfs:label "פעילות"@he ;
    rdfs:label "动态"@zh .

paa:nav_storage rdfs:label "Storage"@en-US ;
    rdfs:label "Stockage"@fr ;
    rdfs:label "Almacenamiento"@es ;
    rdfs:label "אחסון"@he ;
    rdfs:label "存储"@zh .

paa:nav_settings rdfs:label "Settings"@en-US ;
    rdfs:label "Paramètres"@fr ;
    rdfs:label "Configuración"@es ;
    rdfs:label "הגדרות"@he ;
    rdfs:label "设置"@zh .

paa:nav_logout rdfs:label "Logout"@en-US ;
    rdfs:label "Déconnexion"@fr ;
    rdfs:label "Cerrar sesión"@es ;
    rdfs:label "התנתקות"@he ;
    rdfs:label "退出登录"@zh .

# ── Login ─────────────────────────────────────────────

paa:login_title rdfs:label "Login"@en-US ;
    rdfs:label "Connexion"@fr ;
    rdfs:label "Iniciar sesión"@es ;
    rdfs:label "התחברות"@he ;
    rdfs:label "登录"@zh .

paa:login_password rdfs:label "Password"@en-US ;
    rdfs:label "Mot de passe"@fr ;
    rdfs:label "Contraseña"@es ;
    rdfs:label "סיסמה"@he ;
    rdfs:label "密码"@zh .

paa:login_sign_in rdfs:label "Sign In"@en-US ;
    rdfs:label "Se connecter"@fr ;
    rdfs:label "Iniciar sesión"@es ;
    rdfs:label "כניסה"@he ;
    rdfs:label "登录"@zh .

paa:login_passkey rdfs:label "Sign in with Passkey"@en-US ;
    rdfs:label "Se connecter avec une clé d'accès"@fr ;
    rdfs:label "Iniciar sesión con Passkey"@es ;
    rdfs:label "כניסה באמצעות Passkey"@he ;
    rdfs:label "使用 Passkey 登录"@zh .

# ── Dashboard ─────────────────────────────────────────

paa:dash_title rdfs:label "Dashboard"@en-US ;
    rdfs:label "Tableau de bord"@fr ;
    rdfs:label "Panel de control"@es ;
    rdfs:label "לוח בקרה"@he ;
    rdfs:label "仪表板"@zh .

paa:dash_profile rdfs:label "Profile"@en-US ;
    rdfs:label "Profil"@fr ;
    rdfs:label "Perfil"@es ;
    rdfs:label "פרופיל"@he ;
    rdfs:label "个人资料"@zh .

paa:dash_username rdfs:label "Username"@en-US ;
    rdfs:label "Nom d'utilisateur"@fr ;
    rdfs:label "Nombre de usuario"@es ;
    rdfs:label "שם משתמש"@he ;
    rdfs:label "用户名"@zh .

paa:dash_webid rdfs:label "WebID"@en-US ;
    rdfs:label "WebID"@fr ;
    rdfs:label "WebID"@es ;
    rdfs:label "WebID"@he ;
    rdfs:label "WebID"@zh .

paa:dash_actor rdfs:label "Actor"@en-US ;
    rdfs:label "Acteur"@fr ;
    rdfs:label "Actor"@es ;
    rdfs:label "שחקן"@he ;
    rdfs:label "参与者"@zh .

paa:dash_domain rdfs:label "Domain"@en-US ;
    rdfs:label "Domaine"@fr ;
    rdfs:label "Dominio"@es ;
    rdfs:label "דומיין"@he ;
    rdfs:label "域名"@zh .

paa:dash_followers rdfs:label "Followers"@en-US ;
    rdfs:label "Abonnés"@fr ;
    rdfs:label "Seguidores"@es ;
    rdfs:label "עוקבים"@he ;
    rdfs:label "关注者"@zh .

paa:dash_following rdfs:label "Following"@en-US ;
    rdfs:label "Abonnements"@fr ;
    rdfs:label "Siguiendo"@es ;
    rdfs:label "נעקבים"@he ;
    rdfs:label "正在关注"@zh .

paa:dash_posts rdfs:label "Posts"@en-US ;
    rdfs:label "Publications"@fr ;
    rdfs:label "Publicaciones"@es ;
    rdfs:label "פרסומים"@he ;
    rdfs:label "帖子"@zh .

paa:dash_pending_follow_one rdfs:label "{{count}} pending follow request"@en-US ;
    rdfs:label "{{count}} demande d'abonnement en attente"@fr ;
    rdfs:label "{{count}} solicitud de seguimiento pendiente"@es ;
    rdfs:label "{{count}} בקשת מעקב ממתינה"@he ;
    rdfs:label "{{count}} 个待处理的关注请求"@zh .

paa:dash_pending_follow_other rdfs:label "{{count}} pending follow requests"@en-US ;
    rdfs:label "{{count}} demandes d'abonnement en attente"@fr ;
    rdfs:label "{{count}} solicitudes de seguimiento pendientes"@es ;
    rdfs:label "{{count}} בקשות מעקב ממתינות"@he ;
    rdfs:label "{{count}} 个待处理的关注请求"@zh .

paa:dash_review rdfs:label "Review"@en-US ;
    rdfs:label "Examiner"@fr ;
    rdfs:label "Revisar"@es ;
    rdfs:label "סקירה"@he ;
    rdfs:label "审核"@zh .

paa:dash_storage_used rdfs:label "Storage - {{used}} used"@en-US ;
    rdfs:label "Stockage - {{used}} utilisé"@fr ;
    rdfs:label "Almacenamiento - {{used}} en uso"@es ;
    rdfs:label "אחסון - {{used}} בשימוש"@he ;
    rdfs:label "存储 - 已使用 {{used}}"@zh .

paa:dash_resources_one rdfs:label "{{count}} resource across all containers"@en-US ;
    rdfs:label "{{count}} ressource dans tous les conteneurs"@fr ;
    rdfs:label "{{count}} recurso en todos los contenedores"@es ;
    rdfs:label "{{count}} משאב בכל המכולות"@he ;
    rdfs:label "所有容器中共 {{count}} 个资源"@zh .

paa:dash_resources_other rdfs:label "{{count}} resources across all containers"@en-US ;
    rdfs:label "{{count}} ressources dans tous les conteneurs"@fr ;
    rdfs:label "{{count}} recursos en todos los contenedores"@es ;
    rdfs:label "{{count}} משאבים בכל המכולות"@he ;
    rdfs:label "所有容器中共 {{count}} 个资源"@zh .

paa:dash_category rdfs:label "Category"@en-US ;
    rdfs:label "Catégorie"@fr ;
    rdfs:label "Categoría"@es ;
    rdfs:label "קטגוריה"@he ;
    rdfs:label "类别"@zh .

paa:dash_size rdfs:label "Size"@en-US ;
    rdfs:label "Taille"@fr ;
    rdfs:label "Tamaño"@es ;
    rdfs:label "גודל"@he ;
    rdfs:label "大小"@zh .

paa:dash_files rdfs:label "Files"@en-US ;
    rdfs:label "Fichiers"@fr ;
    rdfs:label "Archivos"@es ;
    rdfs:label "קבצים"@he ;
    rdfs:label "文件"@zh .

paa:dash_passkeys rdfs:label "Passkeys"@en-US ;
    rdfs:label "Clés d'accès"@fr ;
    rdfs:label "Passkeys"@es ;
    rdfs:label "Passkeys"@he ;
    rdfs:label "Passkeys"@zh .

paa:dash_name rdfs:label "Name"@en-US ;
    rdfs:label "Nom"@fr ;
    rdfs:label "Nombre"@es ;
    rdfs:label "שם"@he ;
    rdfs:label "名称"@zh .

paa:dash_created rdfs:label "Created"@en-US ;
    rdfs:label "Créé"@fr ;
    rdfs:label "Creado"@es ;
    rdfs:label "נוצר"@he ;
    rdfs:label "创建时间"@zh .

paa:dash_actions rdfs:label "Actions"@en-US ;
    rdfs:label "Actions"@fr ;
    rdfs:label "Acciones"@es ;
    rdfs:label "פעולות"@he ;
    rdfs:label "操作"@zh .

paa:dash_rename rdfs:label "Rename"@en-US ;
    rdfs:label "Renommer"@fr ;
    rdfs:label "Renombrar"@es ;
    rdfs:label "שינוי שם"@he ;
    rdfs:label "重命名"@zh .

paa:dash_delete rdfs:label "Delete"@en-US ;
    rdfs:label "Supprimer"@fr ;
    rdfs:label "Eliminar"@es ;
    rdfs:label "מחיקה"@he ;
    rdfs:label "删除"@zh .

paa:dash_confirm_delete_passkey rdfs:label "Delete this passkey?"@en-US ;
    rdfs:label "Supprimer cette clé d'accès ?"@fr ;
    rdfs:label "¿Eliminar esta passkey?"@es ;
    rdfs:label "למחוק passkey זה?"@he ;
    rdfs:label "删除此 Passkey？"@zh .

paa:dash_no_passkeys rdfs:label "No passkeys registered."@en-US ;
    rdfs:label "Aucune clé d'accès enregistrée."@fr ;
    rdfs:label "No hay passkeys registradas."@es ;
    rdfs:label "לא רשומים passkeys."@he ;
    rdfs:label "未注册任何 Passkey。"@zh .

paa:dash_register_passkey rdfs:label "Register Passkey"@en-US ;
    rdfs:label "Enregistrer une clé d'accès"@fr ;
    rdfs:label "Registrar Passkey"@es ;
    rdfs:label "רישום Passkey"@he ;
    rdfs:label "注册 Passkey"@zh .

paa:dash_everything_else rdfs:label "Everything Else"@en-US ;
    rdfs:label "Tout le reste"@fr ;
    rdfs:label "Todo lo demás"@es ;
    rdfs:label "כל השאר"@he ;
    rdfs:label "其他"@zh .

paa:dash_system_data rdfs:label "system data"@en-US ;
    rdfs:label "données système"@fr ;
    rdfs:label "datos del sistema"@es ;
    rdfs:label "נתוני מערכת"@he ;
    rdfs:label "系统数据"@zh .

paa:dash_n_files_one rdfs:label "{{count}} file"@en-US ;
    rdfs:label "{{count}} fichier"@fr ;
    rdfs:label "{{count}} archivo"@es ;
    rdfs:label "{{count}} קובץ"@he ;
    rdfs:label "{{count}} 个文件"@zh .

paa:dash_n_files_other rdfs:label "{{count}} files"@en-US ;
    rdfs:label "{{count}} fichiers"@fr ;
    rdfs:label "{{count}} archivos"@es ;
    rdfs:label "{{count}} קבצים"@he ;
    rdfs:label "{{count}} 个文件"@zh .

# ── Activity ──────────────────────────────────────────

paa:act_title rdfs:label "Activity"@en-US ;
    rdfs:label "Activité"@fr ;
    rdfs:label "Actividad"@es ;
    rdfs:label "פעילות"@he ;
    rdfs:label "动态"@zh .

paa:act_compose rdfs:label "Compose"@en-US ;
    rdfs:label "Rédiger"@fr ;
    rdfs:label "Redactar"@es ;
    rdfs:label "כתיבה"@he ;
    rdfs:label "撰写"@zh .

paa:act_placeholder rdfs:label "What's on your mind?"@en-US ;
    rdfs:label "Qu'avez-vous en tête ?"@fr ;
    rdfs:label "¿Qué tienes en mente?"@es ;
    rdfs:label "מה עובר לך בראש?"@he ;
    rdfs:label "你在想什么？"@zh .

paa:act_audience rdfs:label "Audience"@en-US ;
    rdfs:label "Audience"@fr ;
    rdfs:label "Audiencia"@es ;
    rdfs:label "קהל"@he ;
    rdfs:label "受众"@zh .

paa:act_public rdfs:label "Public"@en-US ;
    rdfs:label "Public"@fr ;
    rdfs:label "Público"@es ;
    rdfs:label "ציבורי"@he ;
    rdfs:label "公开"@zh .

paa:act_unlisted rdfs:label "Unlisted"@en-US ;
    rdfs:label "Non répertorié"@fr ;
    rdfs:label "No listado"@es ;
    rdfs:label "לא רשום"@he ;
    rdfs:label "不公开"@zh .

paa:act_followers_only rdfs:label "Followers Only"@en-US ;
    rdfs:label "Abonnés uniquement"@fr ;
    rdfs:label "Solo seguidores"@es ;
    rdfs:label "עוקבים בלבד"@he ;
    rdfs:label "仅关注者"@zh .

paa:act_private rdfs:label "Private"@en-US ;
    rdfs:label "Privé"@fr ;
    rdfs:label "Privado"@es ;
    rdfs:label "פרטי"@he ;
    rdfs:label "私密"@zh .

paa:act_content_warning rdfs:label "Content warning (optional)"@en-US ;
    rdfs:label "Avertissement de contenu (facultatif)"@fr ;
    rdfs:label "Advertencia de contenido (opcional)"@es ;
    rdfs:label "אזהרת תוכן (אופציונלי)"@he ;
    rdfs:label "内容警告（可选）"@zh .

paa:act_post rdfs:label "Post"@en-US ;
    rdfs:label "Publier"@fr ;
    rdfs:label "Publicar"@es ;
    rdfs:label "פרסום"@he ;
    rdfs:label "发布"@zh .

paa:act_follow_requests rdfs:label "Follow Requests"@en-US ;
    rdfs:label "Demandes d'abonnement"@fr ;
    rdfs:label "Solicitudes de seguimiento"@es ;
    rdfs:label "בקשות מעקב"@he ;
    rdfs:label "关注请求"@zh .

paa:act_accept rdfs:label "Accept"@en-US ;
    rdfs:label "Accepter"@fr ;
    rdfs:label "Aceptar"@es ;
    rdfs:label "אישור"@he ;
    rdfs:label "接受"@zh .

paa:act_reject rdfs:label "Reject"@en-US ;
    rdfs:label "Rejeter"@fr ;
    rdfs:label "Rechazar"@es ;
    rdfs:label "דחייה"@he ;
    rdfs:label "拒绝"@zh .

paa:act_follow_unfollow rdfs:label "Follow / Unfollow"@en-US ;
    rdfs:label "Suivre / Ne plus suivre"@fr ;
    rdfs:label "Seguir / Dejar de seguir"@es ;
    rdfs:label "מעקב / ביטול מעקב"@he ;
    rdfs:label "关注 / 取消关注"@zh .

paa:act_target_placeholder rdfs:label "user@domain.com or actor URL"@en-US ;
    rdfs:label "user@domain.com ou URL de l'acteur"@fr ;
    rdfs:label "user@domain.com o URL del actor"@es ;
    rdfs:label "user@domain.com או כתובת URL של שחקן"@he ;
    rdfs:label "user@domain.com 或参与者 URL"@zh .

paa:act_follow rdfs:label "Follow"@en-US ;
    rdfs:label "Suivre"@fr ;
    rdfs:label "Seguir"@es ;
    rdfs:label "מעקב"@he ;
    rdfs:label "关注"@zh .

paa:act_following rdfs:label "Following"@en-US ;
    rdfs:label "Abonnements"@fr ;
    rdfs:label "Siguiendo"@es ;
    rdfs:label "נעקבים"@he ;
    rdfs:label "正在关注"@zh .

paa:act_unfollow rdfs:label "Unfollow"@en-US ;
    rdfs:label "Ne plus suivre"@fr ;
    rdfs:label "Dejar de seguir"@es ;
    rdfs:label "ביטול מעקב"@he ;
    rdfs:label "取消关注"@zh .

paa:act_followers rdfs:label "Followers"@en-US ;
    rdfs:label "Abonnés"@fr ;
    rdfs:label "Seguidores"@es ;
    rdfs:label "עוקבים"@he ;
    rdfs:label "关注者"@zh .

paa:act_feed_title rdfs:label "Activity Feed"@en-US ;
    rdfs:label "Fil d'activité"@fr ;
    rdfs:label "Feed de actividad"@es ;
    rdfs:label "עדכוני פעילות"@he ;
    rdfs:label "动态流"@zh .

paa:act_latest rdfs:label "latest {{limit}}"@en-US ;
    rdfs:label "derniers {{limit}}"@fr ;
    rdfs:label "últimos {{limit}}"@es ;
    rdfs:label "{{limit}} אחרונים"@he ;
    rdfs:label "最新 {{limit}} 条"@zh .

paa:act_hide_read rdfs:label "Hide read"@en-US ;
    rdfs:label "Masquer les lus"@fr ;
    rdfs:label "Ocultar leídos"@es ;
    rdfs:label "הסתרת נקראו"@he ;
    rdfs:label "隐藏已读"@zh .

paa:act_show_all rdfs:label "Show all"@en-US ;
    rdfs:label "Tout afficher"@fr ;
    rdfs:label "Mostrar todo"@es ;
    rdfs:label "הצגת הכל"@he ;
    rdfs:label "显示全部"@zh .

paa:act_mark_all_read rdfs:label "Mark all as read"@en-US ;
    rdfs:label "Tout marquer comme lu"@fr ;
    rdfs:label "Marcar todo como leído"@es ;
    rdfs:label "סימון הכל כנקרא"@he ;
    rdfs:label "全部标为已读"@zh .

paa:act_no_activities rdfs:label "No activities yet."@en-US ;
    rdfs:label "Aucune activité pour le moment."@fr ;
    rdfs:label "Aún no hay actividades."@es ;
    rdfs:label "אין עדיין פעילויות."@he ;
    rdfs:label "暂无动态。"@zh .

paa:act_mark_read rdfs:label "Mark as read"@en-US ;
    rdfs:label "Marquer comme lu"@fr ;
    rdfs:label "Marcar como leído"@es ;
    rdfs:label "סימון כנקרא"@he ;
    rdfs:label "标为已读"@zh .

paa:act_cw rdfs:label "CW:"@en-US ;
    rdfs:label "CW :"@fr ;
    rdfs:label "CW:"@es ;
    rdfs:label "CW:"@he ;
    rdfs:label "CW："@zh .

paa:act_follow_arrow rdfs:label "Follow →"@en-US ;
    rdfs:label "Suivre →"@fr ;
    rdfs:label "Seguir →"@es ;
    rdfs:label "מעקב →"@he ;
    rdfs:label "关注 →"@zh .

paa:act_accepted rdfs:label "Accepted activity"@en-US ;
    rdfs:label "Activité acceptée"@fr ;
    rdfs:label "Actividad aceptada"@es ;
    rdfs:label "פעילות שאושרה"@he ;
    rdfs:label "已接受的动态"@zh .

paa:act_undid rdfs:label "Undid activity"@en-US ;
    rdfs:label "Activité annulée"@fr ;
    rdfs:label "Actividad revertida"@es ;
    rdfs:label "פעילות שבוטלה"@he ;
    rdfs:label "已撤销的动态"@zh .

paa:act_type_activity rdfs:label "{{type}} activity"@en-US ;
    rdfs:label "Activité {{type}}"@fr ;
    rdfs:label "Actividad {{type}}"@es ;
    rdfs:label "פעילות {{type}}"@he ;
    rdfs:label "{{type}} 动态"@zh .

paa:act_received rdfs:label "Received"@en-US ;
    rdfs:label "Reçu"@fr ;
    rdfs:label "Recibido"@es ;
    rdfs:label "התקבל"@he ;
    rdfs:label "已接收"@zh .

paa:act_sent rdfs:label "Sent"@en-US ;
    rdfs:label "Envoyé"@fr ;
    rdfs:label "Enviado"@es ;
    rdfs:label "נשלח"@he ;
    rdfs:label "已发送"@zh .

paa:act_remote_feed rdfs:label "Remote Feed"@en-US ;
    rdfs:label "Fil distant"@fr ;
    rdfs:label "Feed remoto"@es ;
    rdfs:label "עדכונים מרוחקים"@he ;
    rdfs:label "远程动态流"@zh .

paa:act_back rdfs:label "Back to Activity"@en-US ;
    rdfs:label "Retour à l'activité"@fr ;
    rdfs:label "Volver a actividad"@es ;
    rdfs:label "חזרה לפעילות"@he ;
    rdfs:label "返回动态"@zh .

paa:act_no_public_activities rdfs:label "No public activities found."@en-US ;
    rdfs:label "Aucune activité publique trouvée."@fr ;
    rdfs:label "No se encontraron actividades públicas."@es ;
    rdfs:label "לא נמצאו פעילויות ציבוריות."@he ;
    rdfs:label "未找到公开动态。"@zh .

paa:act_could_not_load rdfs:label "Could not load actor or outbox."@en-US ;
    rdfs:label "Impossible de charger l'acteur ou la boîte d'envoi."@fr ;
    rdfs:label "No se pudo cargar el actor o la bandeja de salida."@es ;
    rdfs:label "לא ניתן לטעון שחקן או תיבת דואר יוצא."@he ;
    rdfs:label "无法加载参与者或发件箱。"@zh .

paa:act_feed_prefix rdfs:label "Feed:"@en-US ;
    rdfs:label "Fil :"@fr ;
    rdfs:label "Feed:"@es ;
    rdfs:label "עדכונים:"@he ;
    rdfs:label "动态流："@zh .

# ── Storage ───────────────────────────────────────────

paa:stor_title rdfs:label "Storage"@en-US ;
    rdfs:label "Stockage"@fr ;
    rdfs:label "Almacenamiento"@es ;
    rdfs:label "אחסון"@he ;
    rdfs:label "存储"@zh .

paa:stor_path rdfs:label "Path:"@en-US ;
    rdfs:label "Chemin :"@fr ;
    rdfs:label "Ruta:"@es ;
    rdfs:label "נתיב:"@he ;
    rdfs:label "路径："@zh .

paa:stor_contents rdfs:label "Contents"@en-US ;
    rdfs:label "Contenu"@fr ;
    rdfs:label "Contenido"@es ;
    rdfs:label "תוכן"@he ;
    rdfs:label "内容"@zh .

paa:stor_empty rdfs:label "Empty container."@en-US ;
    rdfs:label "Conteneur vide."@fr ;
    rdfs:label "Contenedor vacío."@es ;
    rdfs:label "מכולה ריקה."@he ;
    rdfs:label "空容器。"@zh .

paa:stor_raw rdfs:label "raw"@en-US ;
    rdfs:label "brut"@fr ;
    rdfs:label "crudo"@es ;
    rdfs:label "גולמי"@he ;
    rdfs:label "原始"@zh .

paa:stor_move rdfs:label "move"@en-US ;
    rdfs:label "déplacer"@fr ;
    rdfs:label "mover"@es ;
    rdfs:label "העברה"@he ;
    rdfs:label "移动"@zh .

paa:stor_copy rdfs:label "copy"@en-US ;
    rdfs:label "copier"@fr ;
    rdfs:label "copiar"@es ;
    rdfs:label "העתקה"@he ;
    rdfs:label "复制"@zh .

paa:stor_delete rdfs:label "delete"@en-US ;
    rdfs:label "supprimer"@fr ;
    rdfs:label "eliminar"@es ;
    rdfs:label "מחיקה"@he ;
    rdfs:label "删除"@zh .

paa:stor_access_policy rdfs:label "Access Policy"@en-US ;
    rdfs:label "Politique d'accès"@fr ;
    rdfs:label "Política de acceso"@es ;
    rdfs:label "מדיניות גישה"@he ;
    rdfs:label "访问策略"@zh .

paa:stor_delete_container rdfs:label "Delete Container"@en-US ;
    rdfs:label "Supprimer le conteneur"@fr ;
    rdfs:label "Eliminar contenedor"@es ;
    rdfs:label "מחיקת מכולה"@he ;
    rdfs:label "删除容器"@zh .

paa:stor_confirm_delete_container rdfs:label "Delete this container and all its contents?"@en-US ;
    rdfs:label "Supprimer ce conteneur et tout son contenu ?"@fr ;
    rdfs:label "¿Eliminar este contenedor y todo su contenido?"@es ;
    rdfs:label "למחוק מכולה זו ואת כל תוכנה?"@he ;
    rdfs:label "删除此容器及其所有内容？"@zh .

paa:stor_create_container rdfs:label "Create Container"@en-US ;
    rdfs:label "Créer un conteneur"@fr ;
    rdfs:label "Crear contenedor"@es ;
    rdfs:label "יצירת מכולה"@he ;
    rdfs:label "创建容器"@zh .

paa:stor_container_name rdfs:label "Container name"@en-US ;
    rdfs:label "Nom du conteneur"@fr ;
    rdfs:label "Nombre del contenedor"@es ;
    rdfs:label "שם מכולה"@he ;
    rdfs:label "容器名称"@zh .

paa:stor_create rdfs:label "Create"@en-US ;
    rdfs:label "Créer"@fr ;
    rdfs:label "Crear"@es ;
    rdfs:label "יצירה"@he ;
    rdfs:label "创建"@zh .

paa:stor_upload_file rdfs:label "Upload File"@en-US ;
    rdfs:label "Téléverser un fichier"@fr ;
    rdfs:label "Subir archivo"@es ;
    rdfs:label "העלאת קובץ"@he ;
    rdfs:label "上传文件"@zh .

paa:stor_filename_optional rdfs:label "Filename (optional, uses original name if empty)"@en-US ;
    rdfs:label "Nom de fichier (facultatif, utilise le nom original si vide)"@fr ;
    rdfs:label "Nombre de archivo (opcional, usa el nombre original si está vacío)"@es ;
    rdfs:label "שם קובץ (אופציונלי, משתמש בשם המקורי אם ריק)"@he ;
    rdfs:label "文件名（可选，留空则使用原始文件名）"@zh .

paa:stor_upload rdfs:label "Upload"@en-US ;
    rdfs:label "Téléverser"@fr ;
    rdfs:label "Subir"@es ;
    rdfs:label "העלאה"@he ;
    rdfs:label "上传"@zh .

paa:stor_create_resource rdfs:label "Create Resource"@en-US ;
    rdfs:label "Créer une ressource"@fr ;
    rdfs:label "Crear recurso"@es ;
    rdfs:label "יצירת משאב"@he ;
    rdfs:label "创建资源"@zh .

paa:stor_filename rdfs:label "Filename"@en-US ;
    rdfs:label "Nom de fichier"@fr ;
    rdfs:label "Nombre de archivo"@es ;
    rdfs:label "שם קובץ"@he ;
    rdfs:label "文件名"@zh .

paa:stor_filename_placeholder rdfs:label "e.g. notes.txt, data.ttl, page.html"@en-US ;
    rdfs:label "ex. notes.txt, data.ttl, page.html"@fr ;
    rdfs:label "ej. notes.txt, data.ttl, page.html"@es ;
    rdfs:label "לדוגמה notes.txt, data.ttl, page.html"@he ;
    rdfs:label "例如 notes.txt、data.ttl、page.html"@zh .

paa:stor_enter_content rdfs:label "Enter content..."@en-US ;
    rdfs:label "Saisissez le contenu..."@fr ;
    rdfs:label "Ingrese el contenido..."@es ;
    rdfs:label "הזינו תוכן..."@he ;
    rdfs:label "输入内容..."@zh .

paa:stor_resource rdfs:label "Resource"@en-US ;
    rdfs:label "Ressource"@fr ;
    rdfs:label "Recurso"@es ;
    rdfs:label "משאב"@he ;
    rdfs:label "资源"@zh .

paa:stor_content rdfs:label "Content"@en-US ;
    rdfs:label "Contenu"@fr ;
    rdfs:label "Contenido"@es ;
    rdfs:label "תוכן"@he ;
    rdfs:label "内容"@zh .

paa:stor_save rdfs:label "Save"@en-US ;
    rdfs:label "Enregistrer"@fr ;
    rdfs:label "Guardar"@es ;
    rdfs:label "שמירה"@he ;
    rdfs:label "保存"@zh .

paa:stor_cancel rdfs:label "Cancel"@en-US ;
    rdfs:label "Annuler"@fr ;
    rdfs:label "Cancelar"@es ;
    rdfs:label "ביטול"@he ;
    rdfs:label "取消"@zh .

paa:stor_download rdfs:label "Download File"@en-US ;
    rdfs:label "Télécharger le fichier"@fr ;
    rdfs:label "Descargar archivo"@es ;
    rdfs:label "הורדת קובץ"@he ;
    rdfs:label "下载文件"@zh .

paa:stor_no_content rdfs:label "Resource exists but has no content."@en-US ;
    rdfs:label "La ressource existe mais n'a pas de contenu."@fr ;
    rdfs:label "El recurso existe pero no tiene contenido."@es ;
    rdfs:label "המשאב קיים אך אין בו תוכן."@he ;
    rdfs:label "资源存在但没有内容。"@zh .

paa:stor_view_raw rdfs:label "View Raw"@en-US ;
    rdfs:label "Voir le brut"@fr ;
    rdfs:label "Ver crudo"@es ;
    rdfs:label "תצוגה גולמית"@he ;
    rdfs:label "查看原始数据"@zh .

paa:stor_edit rdfs:label "Edit"@en-US ;
    rdfs:label "Modifier"@fr ;
    rdfs:label "Editar"@es ;
    rdfs:label "עריכה"@he ;
    rdfs:label "编辑"@zh .

paa:stor_move_btn rdfs:label "Move"@en-US ;
    rdfs:label "Déplacer"@fr ;
    rdfs:label "Mover"@es ;
    rdfs:label "העברה"@he ;
    rdfs:label "移动"@zh .

paa:stor_copy_btn rdfs:label "Copy"@en-US ;
    rdfs:label "Copier"@fr ;
    rdfs:label "Copiar"@es ;
    rdfs:label "העתקה"@he ;
    rdfs:label "复制"@zh .

paa:stor_confirm_delete_resource rdfs:label "Delete this resource?"@en-US ;
    rdfs:label "Supprimer cette ressource ?"@fr ;
    rdfs:label "¿Eliminar este recurso?"@es ;
    rdfs:label "למחוק משאב זה?"@he ;
    rdfs:label "删除此资源？"@zh .

paa:stor_metadata rdfs:label "Metadata"@en-US ;
    rdfs:label "Métadonnées"@fr ;
    rdfs:label "Metadatos"@es ;
    rdfs:label "מטא-נתונים"@he ;
    rdfs:label "元数据"@zh .

paa:stor_save_metadata rdfs:label "Save Metadata"@en-US ;
    rdfs:label "Enregistrer les métadonnées"@fr ;
    rdfs:label "Guardar metadatos"@es ;
    rdfs:label "שמירת מטא-נתונים"@he ;
    rdfs:label "保存元数据"@zh .

paa:stor_edit_metadata rdfs:label "Edit Metadata"@en-US ;
    rdfs:label "Modifier les métadonnées"@fr ;
    rdfs:label "Editar metadatos"@es ;
    rdfs:label "עריכת מטא-נתונים"@he ;
    rdfs:label "编辑元数据"@zh .

paa:stor_no_metadata rdfs:label "No metadata."@en-US ;
    rdfs:label "Aucune métadonnée."@fr ;
    rdfs:label "Sin metadatos."@es ;
    rdfs:label "אין מטא-נתונים."@he ;
    rdfs:label "无元数据。"@zh .

paa:stor_remove rdfs:label "Remove"@en-US ;
    rdfs:label "Retirer"@fr ;
    rdfs:label "Quitar"@es ;
    rdfs:label "הסרה"@he ;
    rdfs:label "移除"@zh .

paa:stor_move_to rdfs:label "Move to:"@en-US ;
    rdfs:label "Déplacer vers :"@fr ;
    rdfs:label "Mover a:"@es ;
    rdfs:label "העברה אל:"@he ;
    rdfs:label "移动到："@zh .

paa:stor_copy_to rdfs:label "Copy to:"@en-US ;
    rdfs:label "Copier vers :"@fr ;
    rdfs:label "Copiar a:"@es ;
    rdfs:label "העתקה אל:"@he ;
    rdfs:label "复制到："@zh .

# ── Access Policy (ACP) ──────────────────────────────

paa:acl_title rdfs:label "Access Policy"@en-US ;
    rdfs:label "Politique d'accès"@fr ;
    rdfs:label "Política de acceso"@es ;
    rdfs:label "מדיניות גישה"@he ;
    rdfs:label "访问策略"@zh .

paa:acl_resource rdfs:label "Resource:"@en-US ;
    rdfs:label "Ressource :"@fr ;
    rdfs:label "Recurso:"@es ;
    rdfs:label "משאב:"@he ;
    rdfs:label "资源："@zh .

paa:acl_container_applies rdfs:label "This policy applies to the container and its contents (unless overridden)."@en-US ;
    rdfs:label "Cette politique s'applique au conteneur et à son contenu (sauf remplacement)."@fr ;
    rdfs:label "Esta política se aplica al contenedor y su contenido (a menos que se anule)."@es ;
    rdfs:label "מדיניות זו חלה על המכולה ותוכנה (אלא אם נדרסת)."@he ;
    rdfs:label "此策略适用于该容器及其内容（除非被覆盖）。"@zh .

paa:acl_access_level rdfs:label "Access Level"@en-US ;
    rdfs:label "Niveau d'accès"@fr ;
    rdfs:label "Nivel de acceso"@es ;
    rdfs:label "רמת גישה"@he ;
    rdfs:label "访问级别"@zh .

paa:acl_save_policy rdfs:label "Save Policy"@en-US ;
    rdfs:label "Enregistrer la politique"@fr ;
    rdfs:label "Guardar política"@es ;
    rdfs:label "שמירת מדיניות"@he ;
    rdfs:label "保存策略"@zh .

paa:acl_back rdfs:label "Back"@en-US ;
    rdfs:label "Retour"@fr ;
    rdfs:label "Volver"@es ;
    rdfs:label "חזרה"@he ;
    rdfs:label "返回"@zh .

paa:acl_friends_list rdfs:label "Friends List"@en-US ;
    rdfs:label "Liste d'amis"@fr ;
    rdfs:label "Lista de amistades"@es ;
    rdfs:label "רשימת חברים"@he ;
    rdfs:label "好友列表"@zh .

paa:acl_friends_desc rdfs:label "WebIDs listed here are granted read access when a resource is set to \\"Friends\\" mode."@en-US ;
    rdfs:label "Les WebIDs listés ici ont accès en lecture lorsque la ressource est en mode \\"Friends\\"."@fr ;
    rdfs:label "Los WebIDs listados aquí obtienen acceso de lectura cuando un recurso está en modo \\"Friends\\"."@es ;
    rdfs:label "WebIDs ברשימה זו מקבלים גישת קריאה כשמשאב מוגדר במצב \\"Friends\\"."@he ;
    rdfs:label "此处列出的 WebIDs 在资源设置为 \\"Friends\\" 模式时获得读取权限。"@zh .

paa:acl_remove rdfs:label "remove"@en-US ;
    rdfs:label "retirer"@fr ;
    rdfs:label "quitar"@es ;
    rdfs:label "הסרה"@he ;
    rdfs:label "移除"@zh .

paa:acl_no_friends rdfs:label "No friends added yet."@en-US ;
    rdfs:label "Aucun ami ajouté pour le moment."@fr ;
    rdfs:label "Aún no se han agregado amistades."@es ;
    rdfs:label "טרם נוספו חברים."@he ;
    rdfs:label "尚未添加好友。"@zh .

paa:acl_add_friend rdfs:label "Add Friend"@en-US ;
    rdfs:label "Ajouter un ami"@fr ;
    rdfs:label "Agregar amistad"@es ;
    rdfs:label "הוספת חבר/ה"@he ;
    rdfs:label "添加好友"@zh .

paa:acl_quota rdfs:label "Storage Quota"@en-US ;
    rdfs:label "Quota de stockage"@fr ;
    rdfs:label "Cuota de almacenamiento"@es ;
    rdfs:label "מכסת אחסון"@he ;
    rdfs:label "存储配额"@zh .

paa:acl_quota_desc rdfs:label "Set a storage limit for this container and its contents."@en-US ;
    rdfs:label "Définissez une limite de stockage pour ce conteneur et son contenu."@fr ;
    rdfs:label "Establezca un límite de almacenamiento para este contenedor y su contenido."@es ;
    rdfs:label "הגדירו מגבלת אחסון למכולה זו ולתוכנה."@he ;
    rdfs:label "为此容器及其内容设置存储限制。"@zh .

paa:acl_used rdfs:label "Used:"@en-US ;
    rdfs:label "Utilisé :"@fr ;
    rdfs:label "Usado:"@es ;
    rdfs:label "בשימוש:"@he ;
    rdfs:label "已使用："@zh .

paa:acl_limit_label rdfs:label "Limit (e.g., 500MB, 1GB, or empty for no limit)"@en-US ;
    rdfs:label "Limite (ex. : 500MB, 1GB, ou vide pour aucune limite)"@fr ;
    rdfs:label "Límite (ej., 500MB, 1GB, o vacío para sin límite)"@es ;
    rdfs:label "מגבלה (לדוגמה 500MB, 1GB, או ריק ללא מגבלה)"@he ;
    rdfs:label "限制（例如 500MB、1GB，留空表示无限制）"@zh .

paa:acl_save_quota rdfs:label "Save Quota"@en-US ;
    rdfs:label "Enregistrer le quota"@fr ;
    rdfs:label "Guardar cuota"@es ;
    rdfs:label "שמירת מכסה"@he ;
    rdfs:label "保存配额"@zh .

paa:acl_acp_details rdfs:label "ACP Details"@en-US ;
    rdfs:label "Détails ACP"@fr ;
    rdfs:label "Detalles de ACP"@es ;
    rdfs:label "פרטי ACP"@he ;
    rdfs:label "ACP 详情"@zh .

paa:acl_view_raw rdfs:label "View raw Access Control Policy (Turtle)"@en-US ;
    rdfs:label "Voir la politique de contrôle d'accès brute (Turtle)"@fr ;
    rdfs:label "Ver la política de control de acceso cruda (Turtle)"@es ;
    rdfs:label "הצגת מדיניות בקרת גישה גולמית (Turtle)"@he ;
    rdfs:label "查看原始访问控制策略 (Turtle)"@zh .

paa:acl_allowed_webids rdfs:label "Allowed WebIDs (one per line)"@en-US ;
    rdfs:label "WebIDs autorisés (un par ligne)"@fr ;
    rdfs:label "WebIDs permitidos (uno por línea)"@es ;
    rdfs:label "WebIDs מורשים (אחד בכל שורה)"@he ;
    rdfs:label "允许的 WebIDs（每行一个）"@zh .

paa:acl_allow_inherit rdfs:label "Allow children to inherit this policy"@en-US ;
    rdfs:label "Permettre aux enfants d'hériter de cette politique"@fr ;
    rdfs:label "Permitir que los elementos secundarios hereden esta política"@es ;
    rdfs:label "אפשרו לפריטים מוכלים לרשת מדיניות זו"@he ;
    rdfs:label "允许子项继承此策略"@zh .

paa:acl_inherit_note rdfs:label "When unchecked, resources inside this container must set their own policy."@en-US ;
    rdfs:label "Si décoché, les ressources dans ce conteneur doivent définir leur propre politique."@fr ;
    rdfs:label "Si no está marcado, los recursos dentro de este contenedor deben establecer su propia política."@es ;
    rdfs:label "כשלא מסומן, משאבים במכולה זו חייבים להגדיר מדיניות משלהם."@he ;
    rdfs:label "取消勾选时，此容器中的资源必须设置自己的策略。"@zh .

paa:acl_effective rdfs:label "Effective policy:"@en-US ;
    rdfs:label "Politique effective :"@fr ;
    rdfs:label "Política vigente:"@es ;
    rdfs:label "מדיניות בתוקף:"@he ;
    rdfs:label "生效策略："@zh .

paa:acl_inherited_from rdfs:label "inherited from"@en-US ;
    rdfs:label "hérité de"@fr ;
    rdfs:label "heredado de"@es ;
    rdfs:label "נורש מ"@he ;
    rdfs:label "继承自"@zh .

paa:acl_mode_inherit rdfs:label "Inherit from parent"@en-US ;
    rdfs:label "Hériter du parent"@fr ;
    rdfs:label "Heredar del padre"@es ;
    rdfs:label "ירושה מהמכולה העליונה"@he ;
    rdfs:label "从父级继承"@zh .

paa:acl_mode_public rdfs:label "Public"@en-US ;
    rdfs:label "Public"@fr ;
    rdfs:label "Público"@es ;
    rdfs:label "ציבורי"@he ;
    rdfs:label "公开"@zh .

paa:acl_mode_unlisted rdfs:label "Public (unlisted)"@en-US ;
    rdfs:label "Public (non répertorié)"@fr ;
    rdfs:label "Público (no listado)"@es ;
    rdfs:label "ציבורי (לא רשום)"@he ;
    rdfs:label "公开（不公开列出）"@zh .

paa:acl_mode_friends rdfs:label "Friends"@en-US ;
    rdfs:label "Amis"@fr ;
    rdfs:label "Amistades"@es ;
    rdfs:label "חברים"@he ;
    rdfs:label "好友"@zh .

paa:acl_mode_private rdfs:label "Private"@en-US ;
    rdfs:label "Privé"@fr ;
    rdfs:label "Privado"@es ;
    rdfs:label "פרטי"@he ;
    rdfs:label "私密"@zh .

paa:acl_mode_custom rdfs:label "Custom"@en-US ;
    rdfs:label "Personnalisé"@fr ;
    rdfs:label "Personalizado"@es ;
    rdfs:label "מותאם אישית"@he ;
    rdfs:label "自定义"@zh .

paa:acl_mode_inherit_desc rdfs:label "Use the same access policy as the parent container."@en-US ;
    rdfs:label "Utiliser la même politique d'accès que le conteneur parent."@fr ;
    rdfs:label "Usar la misma política de acceso que el contenedor padre."@es ;
    rdfs:label "שימוש באותה מדיניות גישה כמו המכולה העליונה."@he ;
    rdfs:label "使用与父容器相同的访问策略。"@zh .

paa:acl_mode_public_desc rdfs:label "Anyone can discover and read this resource."@en-US ;
    rdfs:label "N'importe qui peut découvrir et lire cette ressource."@fr ;
    rdfs:label "Cualquier persona puede descubrir y leer este recurso."@es ;
    rdfs:label "כל אחד יכול לגלות ולקרוא משאב זה."@he ;
    rdfs:label "任何人都可以发现和阅读此资源。"@zh .

paa:acl_mode_unlisted_desc rdfs:label "Anyone with the direct link can read, but not listed in container indexes."@en-US ;
    rdfs:label "Toute personne disposant du lien direct peut lire, mais non listé dans les index des conteneurs."@fr ;
    rdfs:label "Cualquier persona con el enlace directo puede leer, pero no aparece en los índices de contenedores."@es ;
    rdfs:label "כל מי שיש לו קישור ישיר יכול לקרוא, אך לא מופיע באינדקסים של מכולות."@he ;
    rdfs:label "任何拥有直接链接的人都可以阅读，但不会出现在容器索引中。"@zh .

paa:acl_mode_friends_desc rdfs:label "Only people in your friends list can read."@en-US ;
    rdfs:label "Seules les personnes de votre liste d'amis peuvent lire."@fr ;
    rdfs:label "Solo las personas en su lista de amistades pueden leer."@es ;
    rdfs:label "רק אנשים ברשימת החברים שלך יכולים לקרוא."@he ;
    rdfs:label "只有好友列表中的人才能阅读。"@zh .

paa:acl_mode_private_desc rdfs:label "Only you can access this resource."@en-US ;
    rdfs:label "Vous seul pouvez accéder à cette ressource."@fr ;
    rdfs:label "Solo usted puede acceder a este recurso."@es ;
    rdfs:label "רק את/ה יכול/ה לגשת למשאב זה."@he ;
    rdfs:label "只有您可以访问此资源。"@zh .

paa:acl_mode_custom_desc rdfs:label "Grant read access to specific WebIDs."@en-US ;
    rdfs:label "Accorder l'accès en lecture à des WebIDs spécifiques."@fr ;
    rdfs:label "Otorgar acceso de lectura a WebIDs específicos."@es ;
    rdfs:label "הענקת גישת קריאה ל-WebIDs ספציפיים."@he ;
    rdfs:label "授予特定 WebIDs 读取权限。"@zh .

# ── Profile Editor ────────────────────────────────────

paa:prof_title rdfs:label "Edit Profile"@en-US ;
    rdfs:label "Modifier le profil"@fr ;
    rdfs:label "Editar perfil"@es ;
    rdfs:label "עריכת פרופיל"@he ;
    rdfs:label "编辑个人资料"@zh .

paa:prof_page rdfs:label "Profile Page"@en-US ;
    rdfs:label "Page de profil"@fr ;
    rdfs:label "Página de perfil"@es ;
    rdfs:label "דף פרופיל"@he ;
    rdfs:label "个人资料页"@zh .

paa:prof_page_desc rdfs:label "Your public profile page is rendered from a layout using your profile data. Use the Page Builder below to customize it."@en-US ;
    rdfs:label "Votre page de profil publique est générée à partir d'une mise en page utilisant vos données de profil. Utilisez le constructeur de page ci-dessous pour la personnaliser."@fr ;
    rdfs:label "Su página de perfil pública se genera a partir de un diseño con sus datos de perfil. Use el constructor de página a continuación para personalizarla."@es ;
    rdfs:label "דף הפרופיל הציבורי שלך מוצג מתוך פריסה המשתמשת בנתוני הפרופיל שלך. השתמשו בבונה הדף למטה כדי להתאים אותו."@he ;
    rdfs:label "您的公开个人资料页面根据布局和个人资料数据生成。使用下方的页面构建器进行自定义。"@zh .

paa:prof_reset_layout rdfs:label "Reset to Default Layout"@en-US ;
    rdfs:label "Réinitialiser la mise en page par défaut"@fr ;
    rdfs:label "Restablecer al diseño predeterminado"@es ;
    rdfs:label "איפוס לפריסת ברירת מחדל"@he ;
    rdfs:label "重置为默认布局"@zh .

paa:prof_confirm_reset rdfs:label "Reset your profile page to the default layout? Any customizations will be lost."@en-US ;
    rdfs:label "Réinitialiser votre page de profil à la mise en page par défaut ? Toutes les personnalisations seront perdues."@fr ;
    rdfs:label "¿Restablecer su página de perfil al diseño predeterminado? Se perderán todas las personalizaciones."@es ;
    rdfs:label "לאפס את דף הפרופיל לפריסת ברירת המחדל? כל ההתאמות האישיות יאבדו."@he ;
    rdfs:label "将个人资料页面重置为默认布局？所有自定义内容将丢失。"@zh .

paa:prof_fields rdfs:label "Profile Fields"@en-US ;
    rdfs:label "Champs du profil"@fr ;
    rdfs:label "Campos del perfil"@es ;
    rdfs:label "שדות פרופיל"@he ;
    rdfs:label "个人资料字段"@zh .

paa:prof_name rdfs:label "Name (foaf:name)"@en-US ;
    rdfs:label "Nom (foaf:name)"@fr ;
    rdfs:label "Nombre (foaf:name)"@es ;
    rdfs:label "שם (foaf:name)"@he ;
    rdfs:label "名称 (foaf:name)"@zh .

paa:prof_nick rdfs:label "Nickname (foaf:nick)"@en-US ;
    rdfs:label "Surnom (foaf:nick)"@fr ;
    rdfs:label "Apodo (foaf:nick)"@es ;
    rdfs:label "כינוי (foaf:nick)"@he ;
    rdfs:label "昵称 (foaf:nick)"@zh .

paa:prof_avatar rdfs:label "Avatar URL (foaf:img)"@en-US ;
    rdfs:label "URL de l'avatar (foaf:img)"@fr ;
    rdfs:label "URL del avatar (foaf:img)"@es ;
    rdfs:label "כתובת URL של אווטאר (foaf:img)"@he ;
    rdfs:label "头像 URL (foaf:img)"@zh .

paa:prof_email rdfs:label "Email (foaf:mbox)"@en-US ;
    rdfs:label "Courriel (foaf:mbox)"@fr ;
    rdfs:label "Correo electrónico (foaf:mbox)"@es ;
    rdfs:label "דוא״ל (foaf:mbox)"@he ;
    rdfs:label "电子邮箱 (foaf:mbox)"@zh .

paa:prof_homepage rdfs:label "Homepage (foaf:homepage)"@en-US ;
    rdfs:label "Page d'accueil (foaf:homepage)"@fr ;
    rdfs:label "Página de inicio (foaf:homepage)"@es ;
    rdfs:label "דף בית (foaf:homepage)"@he ;
    rdfs:label "主页 (foaf:homepage)"@zh .

paa:prof_bio rdfs:label "Bio (vcard:note)"@en-US ;
    rdfs:label "Biographie (vcard:note)"@fr ;
    rdfs:label "Biografía (vcard:note)"@es ;
    rdfs:label "ביוגרפיה (vcard:note)"@he ;
    rdfs:label "简介 (vcard:note)"@zh .

paa:prof_role rdfs:label "Role (vcard:role)"@en-US ;
    rdfs:label "Rôle (vcard:role)"@fr ;
    rdfs:label "Rol (vcard:role)"@es ;
    rdfs:label "תפקיד (vcard:role)"@he ;
    rdfs:label "角色 (vcard:role)"@zh .

paa:prof_description rdfs:label "Description (schema:description)"@en-US ;
    rdfs:label "Description (schema:description)"@fr ;
    rdfs:label "Descripción (schema:description)"@es ;
    rdfs:label "תיאור (schema:description)"@he ;
    rdfs:label "描述 (schema:description)"@zh .

paa:prof_placeholder_name rdfs:label "Your display name"@en-US ;
    rdfs:label "Votre nom d'affichage"@fr ;
    rdfs:label "Su nombre para mostrar"@es ;
    rdfs:label "שם התצוגה שלך"@he ;
    rdfs:label "您的显示名称"@zh .

paa:prof_placeholder_nick rdfs:label "Short handle or alias"@en-US ;
    rdfs:label "Pseudonyme ou alias court"@fr ;
    rdfs:label "Alias o nombre corto"@es ;
    rdfs:label "כינוי או שם קצר"@he ;
    rdfs:label "简短昵称或别名"@zh .

paa:prof_placeholder_avatar rdfs:label "https://example.com/photo.jpg"@en-US ;
    rdfs:label "https://example.com/photo.jpg"@fr ;
    rdfs:label "https://example.com/photo.jpg"@es ;
    rdfs:label "https://example.com/photo.jpg"@he ;
    rdfs:label "https://example.com/photo.jpg"@zh .

paa:prof_placeholder_email rdfs:label "you@example.com"@en-US ;
    rdfs:label "you@example.com"@fr ;
    rdfs:label "you@example.com"@es ;
    rdfs:label "you@example.com"@he ;
    rdfs:label "you@example.com"@zh .

paa:prof_placeholder_homepage rdfs:label "https://yoursite.com"@en-US ;
    rdfs:label "https://yoursite.com"@fr ;
    rdfs:label "https://yoursite.com"@es ;
    rdfs:label "https://yoursite.com"@he ;
    rdfs:label "https://yoursite.com"@zh .

paa:prof_placeholder_bio rdfs:label "A short bio about yourself"@en-US ;
    rdfs:label "Une courte biographie à propos de vous"@fr ;
    rdfs:label "Una breve biografía sobre usted"@es ;
    rdfs:label "ביוגרפיה קצרה על עצמך"@he ;
    rdfs:label "关于您的简短介绍"@zh .

paa:prof_placeholder_role rdfs:label "Developer, Artist, etc."@en-US ;
    rdfs:label "Développeur, Artiste, etc."@fr ;
    rdfs:label "Desarrollador, Artista, etc."@es ;
    rdfs:label "מפתח/ת, אמן/ית, וכו׳"@he ;
    rdfs:label "开发者、艺术家等"@zh .

paa:prof_placeholder_desc rdfs:label "A longer description"@en-US ;
    rdfs:label "Une description plus détaillée"@fr ;
    rdfs:label "Una descripción más detallada"@es ;
    rdfs:label "תיאור מפורט יותר"@he ;
    rdfs:label "更详细的描述"@zh .

paa:prof_custom_prefixes rdfs:label "Custom Prefixes"@en-US ;
    rdfs:label "Préfixes personnalisés"@fr ;
    rdfs:label "Prefijos personalizados"@es ;
    rdfs:label "קידומות מותאמות"@he ;
    rdfs:label "自定义前缀"@zh .

paa:prof_custom_prefixes_desc rdfs:label "Define namespace prefixes for custom triples. These are used for Turtle shorthand and template keys."@en-US ;
    rdfs:label "Définissez des préfixes d'espace de noms pour les triplets personnalisés. Ils sont utilisés pour la notation abrégée Turtle et les clés de modèle."@fr ;
    rdfs:label "Defina prefijos de espacio de nombres para triples personalizados. Se usan para la notación abreviada de Turtle y las claves de plantilla."@es ;
    rdfs:label "הגדירו קידומות מרחב שמות עבור שלשות מותאמות. אלו משמשים לקיצורי Turtle ולמפתחות תבנית."@he ;
    rdfs:label "为自定义三元组定义命名空间前缀。这些前缀用于 Turtle 缩写和模板键。"@zh .

paa:prof_prefix rdfs:label "Prefix"@en-US ;
    rdfs:label "Préfixe"@fr ;
    rdfs:label "Prefijo"@es ;
    rdfs:label "קידומת"@he ;
    rdfs:label "前缀"@zh .

paa:prof_namespace rdfs:label "Namespace IRI"@en-US ;
    rdfs:label "IRI de l'espace de noms"@fr ;
    rdfs:label "IRI del espacio de nombres"@es ;
    rdfs:label "IRI של מרחב שמות"@he ;
    rdfs:label "命名空间 IRI"@zh .

paa:prof_remove rdfs:label "Remove"@en-US ;
    rdfs:label "Retirer"@fr ;
    rdfs:label "Quitar"@es ;
    rdfs:label "הסרה"@he ;
    rdfs:label "移除"@zh .

paa:prof_add_prefix rdfs:label "Add Prefix"@en-US ;
    rdfs:label "Ajouter un préfixe"@fr ;
    rdfs:label "Agregar prefijo"@es ;
    rdfs:label "הוספת קידומת"@he ;
    rdfs:label "添加前缀"@zh .

paa:prof_connections rdfs:label "Connections"@en-US ;
    rdfs:label "Connexions"@fr ;
    rdfs:label "Conexiones"@es ;
    rdfs:label "קשרים"@he ;
    rdfs:label "联系人"@zh .

paa:prof_connections_desc rdfs:label "People you know (foaf:knows). Add WebIDs or profile URIs. ActivityPub followers and following are included automatically."@en-US ;
    rdfs:label "Personnes que vous connaissez (foaf:knows). Ajoutez des WebIDs ou des URIs de profil. Les abonnés et abonnements ActivityPub sont inclus automatiquement."@fr ;
    rdfs:label "Personas que conoce (foaf:knows). Agregue WebIDs o URIs de perfil. Los seguidores y seguidos de ActivityPub se incluyen automáticamente."@es ;
    rdfs:label "אנשים שאתם מכירים (foaf:knows). הוסיפו WebIDs או URIs של פרופיל. עוקבים ונעקבים של ActivityPub נכללים אוטומטית."@he ;
    rdfs:label "您认识的人 (foaf:knows)。添加 WebIDs 或个人资料 URIs。ActivityPub 的关注者和正在关注会自动包含。"@zh .

paa:prof_add_connection rdfs:label "Add Connection"@en-US ;
    rdfs:label "Ajouter une connexion"@fr ;
    rdfs:label "Agregar conexión"@es ;
    rdfs:label "הוספת קשר"@he ;
    rdfs:label "添加联系人"@zh .

paa:prof_following rdfs:label "Following"@en-US ;
    rdfs:label "Abonnements"@fr ;
    rdfs:label "Siguiendo"@es ;
    rdfs:label "נעקבים"@he ;
    rdfs:label "正在关注"@zh .

paa:prof_followers rdfs:label "Followers"@en-US ;
    rdfs:label "Abonnés"@fr ;
    rdfs:label "Seguidores"@es ;
    rdfs:label "עוקבים"@he ;
    rdfs:label "关注者"@zh .

paa:prof_custom_triples rdfs:label "Add/Edit Custom Triples"@en-US ;
    rdfs:label "Ajouter/Modifier des triplets personnalisés"@fr ;
    rdfs:label "Agregar/Editar triples personalizados"@es ;
    rdfs:label "הוספה/עריכה של שלשות מותאמות"@he ;
    rdfs:label "添加/编辑自定义三元组"@zh .

paa:prof_custom_triples_desc rdfs:label "Add custom predicate-object pairs for your WebID subject."@en-US ;
    rdfs:label "Ajoutez des paires prédicat-objet personnalisées pour votre sujet WebID."@fr ;
    rdfs:label "Agregue pares predicado-objeto personalizados para su sujeto WebID."@es ;
    rdfs:label "הוסיפו זוגות פרדיקט-אובייקט מותאמים עבור נושא ה-WebID שלכם."@he ;
    rdfs:label "为您的 WebID 主语添加自定义谓语-宾语对。"@zh .

paa:prof_system_triples rdfs:label "System Triples (read-only)"@en-US ;
    rdfs:label "Triplets système (lecture seule)"@fr ;
    rdfs:label "Triples del sistema (solo lectura)"@es ;
    rdfs:label "שלשות מערכת (קריאה בלבד)"@he ;
    rdfs:label "系统三元组（只读）"@zh .

paa:prof_page_builder rdfs:label "Page Builder"@en-US ;
    rdfs:label "Constructeur de page"@fr ;
    rdfs:label "Constructor de página"@es ;
    rdfs:label "בונה דפים"@he ;
    rdfs:label "页面构建器"@zh .

paa:prof_page_builder_desc rdfs:label "Build your profile page layout. Elements render in order. Click to edit."@en-US ;
    rdfs:label "Construisez la mise en page de votre profil. Les éléments s'affichent dans l'ordre. Cliquez pour modifier."@fr ;
    rdfs:label "Construya el diseño de su página de perfil. Los elementos se muestran en orden. Haga clic para editar."@es ;
    rdfs:label "בנו את פריסת דף הפרופיל שלכם. אלמנטים מוצגים לפי הסדר. לחצו לעריכה."@he ;
    rdfs:label "构建您的个人资料页面布局。元素按顺序渲染。点击即可编辑。"@zh .

paa:prof_save rdfs:label "Save Profile"@en-US ;
    rdfs:label "Enregistrer le profil"@fr ;
    rdfs:label "Guardar perfil"@es ;
    rdfs:label "שמירת פרופיל"@he ;
    rdfs:label "保存个人资料"@zh .

paa:prof_cancel rdfs:label "Cancel"@en-US ;
    rdfs:label "Annuler"@fr ;
    rdfs:label "Cancelar"@es ;
    rdfs:label "ביטול"@he ;
    rdfs:label "取消"@zh .

paa:prof_saved rdfs:label "Profile updated successfully."@en-US ;
    rdfs:label "Profil mis à jour avec succès."@fr ;
    rdfs:label "Perfil actualizado correctamente."@es ;
    rdfs:label "הפרופיל עודכן בהצלחה."@he ;
    rdfs:label "个人资料更新成功。"@zh .

paa:prof_reset_success rdfs:label "Profile page reset to default template."@en-US ;
    rdfs:label "Page de profil réinitialisée au modèle par défaut."@fr ;
    rdfs:label "Página de perfil restablecida a la plantilla predeterminada."@es ;
    rdfs:label "דף הפרופיל אופס לתבנית ברירת המחדל."@he ;
    rdfs:label "个人资料页面已重置为默认模板。"@zh .

paa:prof_find_ontologies rdfs:label "Find ontologies:"@en-US ;
    rdfs:label "Rechercher des ontologies :"@fr ;
    rdfs:label "Buscar ontologías:"@es ;
    rdfs:label "חיפוש אונטולוגיות:"@he ;
    rdfs:label "查找本体："@zh .

paa:prof_head rdfs:label "+ Head"@en-US ;
    rdfs:label "+ Head"@fr ;
    rdfs:label "+ Head"@es ;
    rdfs:label "+ Head"@he ;
    rdfs:label "+ Head"@zh .

paa:prof_body rdfs:label "+ Body"@en-US ;
    rdfs:label "+ Body"@fr ;
    rdfs:label "+ Body"@es ;
    rdfs:label "+ Body"@he ;
    rdfs:label "+ Body"@zh .

paa:prof_import_component rdfs:label "Import Component"@en-US ;
    rdfs:label "Importer un composant"@fr ;
    rdfs:label "Importar componente"@es ;
    rdfs:label "ייבוא רכיב"@he ;
    rdfs:label "导入组件"@zh .

paa:prof_preview rdfs:label "Preview"@en-US ;
    rdfs:label "Aperçu"@fr ;
    rdfs:label "Vista previa"@es ;
    rdfs:label "תצוגה מקדימה"@he ;
    rdfs:label "预览"@zh .

# ── App Permissions (within Settings) ─────────────────

paa:apps_title rdfs:label "App Permissions"@en-US ;
    rdfs:label "Permissions des applications"@fr ;
    rdfs:label "Permisos de aplicaciones"@es ;
    rdfs:label "הרשאות יישומים"@he ;
    rdfs:label "应用权限"@zh .

paa:apps_desc rdfs:label "Manage which Solid apps can write to your pod and which containers they can access."@en-US ;
    rdfs:label "Gérez quelles applications Solid peuvent écrire dans votre pod et à quels conteneurs elles peuvent accéder."@fr ;
    rdfs:label "Administre qué aplicaciones Solid pueden escribir en su pod y a qué contenedores pueden acceder."@es ;
    rdfs:label "נהלו אילו יישומי Solid יכולים לכתוב ל-pod שלכם ולאילו מכולות הם יכולים לגשת."@he ;
    rdfs:label "管理哪些 Solid 应用可以写入您的 pod 以及它们可以访问哪些容器。"@zh .

paa:apps_authorized rdfs:label "Authorized:"@en-US ;
    rdfs:label "Autorisé :"@fr ;
    rdfs:label "Autorizado:"@es ;
    rdfs:label "מורשה:"@he ;
    rdfs:label "已授权："@zh .

paa:apps_allowed_containers rdfs:label "Allowed containers:"@en-US ;
    rdfs:label "Conteneurs autorisés :"@fr ;
    rdfs:label "Contenedores permitidos:"@es ;
    rdfs:label "מכולות מורשות:"@he ;
    rdfs:label "允许的容器："@zh .

paa:apps_no_write rdfs:label "No write access granted."@en-US ;
    rdfs:label "Aucun accès en écriture accordé."@fr ;
    rdfs:label "No se ha otorgado acceso de escritura."@es ;
    rdfs:label "לא הוענקה גישת כתיבה."@he ;
    rdfs:label "未授予写入权限。"@zh .

paa:apps_update_access rdfs:label "Update container access"@en-US ;
    rdfs:label "Mettre à jour l'accès aux conteneurs"@fr ;
    rdfs:label "Actualizar acceso a contenedores"@es ;
    rdfs:label "עדכון גישה למכולות"@he ;
    rdfs:label "更新容器访问权限"@zh .

paa:apps_update rdfs:label "Update Access"@en-US ;
    rdfs:label "Mettre à jour l'accès"@fr ;
    rdfs:label "Actualizar acceso"@es ;
    rdfs:label "עדכון גישה"@he ;
    rdfs:label "更新权限"@zh .

paa:apps_revoke rdfs:label "Revoke Access"@en-US ;
    rdfs:label "Révoquer l'accès"@fr ;
    rdfs:label "Revocar acceso"@es ;
    rdfs:label "ביטול גישה"@he ;
    rdfs:label "撤销权限"@zh .

paa:apps_none rdfs:label "No apps have been authorized yet."@en-US ;
    rdfs:label "Aucune application n'a encore été autorisée."@fr ;
    rdfs:label "Aún no se han autorizado aplicaciones."@es ;
    rdfs:label "טרם אושרו יישומים."@he ;
    rdfs:label "尚未授权任何应用。"@zh .

# ── Settings ──────────────────────────────────────────

paa:set_title rdfs:label "Settings"@en-US ;
    rdfs:label "Paramètres"@fr ;
    rdfs:label "Configuración"@es ;
    rdfs:label "הגדרות"@he ;
    rdfs:label "设置"@zh .

paa:set_language_locale rdfs:label "Language & Locale"@en-US ;
    rdfs:label "Langue et paramètres régionaux"@fr ;
    rdfs:label "Idioma y configuración regional"@es ;
    rdfs:label "שפה ואזור"@he ;
    rdfs:label "语言和区域设置"@zh .

paa:set_language rdfs:label "Language"@en-US ;
    rdfs:label "Langue"@fr ;
    rdfs:label "Idioma"@es ;
    rdfs:label "שפה"@he ;
    rdfs:label "语言"@zh .

paa:set_date_format rdfs:label "Date format"@en-US ;
    rdfs:label "Format de date"@fr ;
    rdfs:label "Formato de fecha"@es ;
    rdfs:label "תבנית תאריך"@he ;
    rdfs:label "日期格式"@zh .

paa:set_date_short rdfs:label "Short"@en-US ;
    rdfs:label "Court"@fr ;
    rdfs:label "Corto"@es ;
    rdfs:label "קצר"@he ;
    rdfs:label "短"@zh .

paa:set_date_medium rdfs:label "Medium"@en-US ;
    rdfs:label "Moyen"@fr ;
    rdfs:label "Medio"@es ;
    rdfs:label "בינוני"@he ;
    rdfs:label "中"@zh .

paa:set_date_long rdfs:label "Long"@en-US ;
    rdfs:label "Long"@fr ;
    rdfs:label "Largo"@es ;
    rdfs:label "ארוך"@he ;
    rdfs:label "长"@zh .

paa:set_save_prefs rdfs:label "Save Preferences"@en-US ;
    rdfs:label "Enregistrer les préférences"@fr ;
    rdfs:label "Guardar preferencias"@es ;
    rdfs:label "שמירת העדפות"@he ;
    rdfs:label "保存偏好设置"@zh .

paa:set_app_management rdfs:label "App Management"@en-US ;
    rdfs:label "Gestion des applications"@fr ;
    rdfs:label "Gestión de aplicaciones"@es ;
    rdfs:label "ניהול יישומים"@he ;
    rdfs:label "应用管理"@zh .

paa:set_prefs_saved rdfs:label "Preferences saved."@en-US ;
    rdfs:label "Préférences enregistrées."@fr ;
    rdfs:label "Preferencias guardadas."@es ;
    rdfs:label "ההעדפות נשמרו."@he ;
    rdfs:label "偏好设置已保存。"@zh .

# ── OIDC Authorize ────────────────────────────────────

paa:auth_title rdfs:label "Authorize"@en-US ;
    rdfs:label "Autoriser"@fr ;
    rdfs:label "Autorizar"@es ;
    rdfs:label "אישור"@he ;
    rdfs:label "授权"@zh .

paa:auth_app_wants_access rdfs:label "This application wants to access your Solid pod."@en-US ;
    rdfs:label "Cette application souhaite accéder à votre pod Solid."@fr ;
    rdfs:label "Esta aplicación quiere acceder a su pod Solid."@es ;
    rdfs:label "יישום זה מבקש גישה ל-pod ה-Solid שלך."@he ;
    rdfs:label "此应用想要访问您的 Solid pod。"@zh .

paa:auth_password rdfs:label "Password"@en-US ;
    rdfs:label "Mot de passe"@fr ;
    rdfs:label "Contraseña"@es ;
    rdfs:label "סיסמה"@he ;
    rdfs:label "密码"@zh .

paa:auth_write_access rdfs:label "Allow write access to:"@en-US ;
    rdfs:label "Autoriser l'accès en écriture à :"@fr ;
    rdfs:label "Permitir acceso de escritura a:"@es ;
    rdfs:label "אפשרו גישת כתיבה אל:"@he ;
    rdfs:label "允许写入权限到："@zh .

paa:auth_remember rdfs:label "Remember this app (skip consent next time)"@en-US ;
    rdfs:label "Se souvenir de cette application (ignorer le consentement la prochaine fois)"@fr ;
    rdfs:label "Recordar esta aplicación (omitir consentimiento la próxima vez)"@es ;
    rdfs:label "זכרו יישום זה (דלגו על הסכמה בפעם הבאה)"@he ;
    rdfs:label "记住此应用（下次跳过授权确认）"@zh .

paa:auth_approve rdfs:label "Approve"@en-US ;
    rdfs:label "Approuver"@fr ;
    rdfs:label "Aprobar"@es ;
    rdfs:label "אישור"@he ;
    rdfs:label "批准"@zh .

paa:auth_deny rdfs:label "Deny"@en-US ;
    rdfs:label "Refuser"@fr ;
    rdfs:label "Denegar"@es ;
    rdfs:label "דחייה"@he ;
    rdfs:label "拒绝"@zh .

paa:auth_invalid_password rdfs:label "Invalid password"@en-US ;
    rdfs:label "Mot de passe invalide"@fr ;
    rdfs:label "Contraseña inválida"@es ;
    rdfs:label "סיסמה שגויה"@he ;
    rdfs:label "密码无效"@zh .

paa:auth_try_again rdfs:label "Try Again"@en-US ;
    rdfs:label "Réessayer"@fr ;
    rdfs:label "Intentar de nuevo"@es ;
    rdfs:label "ניסיון חוזר"@he ;
    rdfs:label "重试"@zh .

# ── Shared Buttons ────────────────────────────────────

paa:btn_save rdfs:label "Save"@en-US ;
    rdfs:label "Enregistrer"@fr ;
    rdfs:label "Guardar"@es ;
    rdfs:label "שמירה"@he ;
    rdfs:label "保存"@zh .

paa:btn_cancel rdfs:label "Cancel"@en-US ;
    rdfs:label "Annuler"@fr ;
    rdfs:label "Cancelar"@es ;
    rdfs:label "ביטול"@he ;
    rdfs:label "取消"@zh .

paa:btn_delete rdfs:label "Delete"@en-US ;
    rdfs:label "Supprimer"@fr ;
    rdfs:label "Eliminar"@es ;
    rdfs:label "מחיקה"@he ;
    rdfs:label "删除"@zh .

paa:btn_create rdfs:label "Create"@en-US ;
    rdfs:label "Créer"@fr ;
    rdfs:label "Crear"@es ;
    rdfs:label "יצירה"@he ;
    rdfs:label "创建"@zh .

paa:btn_upload rdfs:label "Upload"@en-US ;
    rdfs:label "Téléverser"@fr ;
    rdfs:label "Subir"@es ;
    rdfs:label "העלאה"@he ;
    rdfs:label "上传"@zh .

paa:btn_remove rdfs:label "Remove"@en-US ;
    rdfs:label "Retirer"@fr ;
    rdfs:label "Quitar"@es ;
    rdfs:label "הסרה"@he ;
    rdfs:label "移除"@zh .

paa:btn_back rdfs:label "Back"@en-US ;
    rdfs:label "Retour"@fr ;
    rdfs:label "Volver"@es ;
    rdfs:label "חזרה"@he ;
    rdfs:label "返回"@zh .
`;
