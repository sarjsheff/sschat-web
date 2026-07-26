// APNs integration для Tauri iOS приложения.
//
// Запрашивает разрешение на push-уведомления + регистрируется в APNs.
// Захватывает device token через swizzling AppDelegate method и сохраняет
// в hex-формате в ~/Documents/sschat/apns_token - откуда Rust подхватывает.
//
// Триггер: запускается из +load (до AppDelegate инициализации). Через
// UIApplicationDidFinishLaunchingNotification дожидается готовности AppDelegate,
// потом swizzle'ит метод и запрашивает permission.

#import <UIKit/UIKit.h>
#import <UserNotifications/UserNotifications.h>
#import <objc/runtime.h>

static void writeTokenToFile(NSData *deviceToken) {
    NSMutableString *hex = [NSMutableString stringWithCapacity:deviceToken.length * 2];
    const unsigned char *bytes = (const unsigned char *)deviceToken.bytes;
    for (NSUInteger i = 0; i < deviceToken.length; i++) {
        [hex appendFormat:@"%02x", bytes[i]];
    }
    NSString *home = NSHomeDirectory();
    NSString *dir = [home stringByAppendingPathComponent:@"Documents/sschat"];
    [[NSFileManager defaultManager] createDirectoryAtPath:dir
                              withIntermediateDirectories:YES
                                               attributes:nil
                                                    error:nil];
    NSString *path = [dir stringByAppendingPathComponent:@"apns_token"];
    [hex writeToFile:path atomically:YES encoding:NSUTF8StringEncoding error:nil];
    NSLog(@"[sschat-push] APNs token saved (%lu bytes hex)", (unsigned long)hex.length);
}

static void writeRegistrationErrorToFile(NSError *error) {
    NSString *home = NSHomeDirectory();
    NSString *dir = [home stringByAppendingPathComponent:@"Documents/sschat"];
    NSString *path = [dir stringByAppendingPathComponent:@"apns_error.log"];
    NSString *msg = [NSString stringWithFormat:@"%@\n", error.localizedDescription];
    [msg writeToFile:path atomically:YES encoding:NSUTF8StringEncoding error:nil];
    NSLog(@"[sschat-push] registration failed: %@", error);
}

@interface SSChatPushHelper : NSObject
@end

@implementation SSChatPushHelper

+ (void)load {
    [[NSNotificationCenter defaultCenter]
        addObserverForName:UIApplicationDidFinishLaunchingNotification
                    object:nil
                     queue:nil
                usingBlock:^(NSNotification * _Nonnull note) {
        // Swizzle AppDelegate чтобы поймать device token.
        id<UIApplicationDelegate> delegate = [UIApplication sharedApplication].delegate;
        if (delegate) {
            Class cls = [delegate class];

            // didRegisterForRemoteNotificationsWithDeviceToken
            IMP successImp = imp_implementationWithBlock(^(id self, UIApplication *app, NSData *token) {
                writeTokenToFile(token);
            });
            SEL successSel = @selector(application:didRegisterForRemoteNotificationsWithDeviceToken:);
            if (!class_addMethod(cls, successSel, successImp, "v@:@@")) {
                Method existing = class_getInstanceMethod(cls, successSel);
                if (existing) method_setImplementation(existing, successImp);
            }

            // didFailToRegisterForRemoteNotificationsWithError
            IMP failImp = imp_implementationWithBlock(^(id self, UIApplication *app, NSError *err) {
                writeRegistrationErrorToFile(err);
            });
            SEL failSel = @selector(application:didFailToRegisterForRemoteNotificationsWithError:);
            if (!class_addMethod(cls, failSel, failImp, "v@:@@")) {
                Method existing = class_getInstanceMethod(cls, failSel);
                if (existing) method_setImplementation(existing, failImp);
            }
        }

        // Запрашиваем разрешение + регистрируемся в APNs.
        UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
        UNAuthorizationOptions opts = UNAuthorizationOptionAlert
                                    | UNAuthorizationOptionSound
                                    | UNAuthorizationOptionBadge;
        [center requestAuthorizationWithOptions:opts
                              completionHandler:^(BOOL granted, NSError * _Nullable error) {
            NSLog(@"[sschat-push] permission granted=%d error=%@", granted, error);
            if (granted) {
                dispatch_async(dispatch_get_main_queue(), ^{
                    [[UIApplication sharedApplication] registerForRemoteNotifications];
                });
            }
        }];
    }];
}

@end
