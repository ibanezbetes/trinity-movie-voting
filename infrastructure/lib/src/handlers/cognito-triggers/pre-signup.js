"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client = new client_dynamodb_1.DynamoDBClient({});
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(client);
const USERNAMES_TABLE = process.env.USERNAMES_TABLE || 'trinity-usernames';
/**
 * Cognito Pre Sign-up Trigger
 * Auto-confirms users and their email addresses
 * Validates username availability (does NOT store it yet)
 */
const handler = async (event) => {
    console.log('Pre Sign-up Trigger invoked', {
        userPoolId: event.userPoolId,
        userName: event.userName,
        email: event.request.userAttributes.email,
        preferredUsername: event.request.userAttributes.preferred_username,
    });
    // Auto-confirm the user
    event.response.autoConfirmUser = true;
    // Auto-verify the email
    if (event.request.userAttributes.email) {
        event.response.autoVerifyEmail = true;
    }
    // Validate username availability if preferred_username is provided
    const preferredUsername = event.request.userAttributes.preferred_username;
    if (preferredUsername) {
        try {
            const result = await docClient.send(new lib_dynamodb_1.GetCommand({
                TableName: USERNAMES_TABLE,
                Key: {
                    username: preferredUsername.toLowerCase().trim(),
                },
            }));
            // If username exists, fail the registration
            if (result.Item) {
                console.error('Username already exists', { username: preferredUsername });
                throw new Error('El nombre de usuario ya está en uso');
            }
            console.log('Username available', { username: preferredUsername });
        }
        catch (error) {
            if (error.message === 'El nombre de usuario ya está en uso') {
                throw error;
            }
            console.error('Failed to check username availability', error);
            // Don't fail registration if DynamoDB check fails
        }
    }
    console.log('User auto-confirmed', {
        userName: event.userName,
        autoConfirmUser: event.response.autoConfirmUser,
        autoVerifyEmail: event.response.autoVerifyEmail,
    });
    return event;
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJlLXNpZ251cC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9oYW5kbGVycy9jb2duaXRvLXRyaWdnZXJzL3ByZS1zaWdudXAudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsOERBQTBEO0FBQzFELHdEQUEyRTtBQUUzRSxNQUFNLE1BQU0sR0FBRyxJQUFJLGdDQUFjLENBQUMsRUFBRSxDQUFDLENBQUM7QUFDdEMsTUFBTSxTQUFTLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBRXRELE1BQU0sZUFBZSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsZUFBZSxJQUFJLG1CQUFtQixDQUFDO0FBRTNFOzs7O0dBSUc7QUFDSSxNQUFNLE9BQU8sR0FBNEIsS0FBSyxFQUNuRCxLQUE0QixFQUNJLEVBQUU7SUFDbEMsT0FBTyxDQUFDLEdBQUcsQ0FBQyw2QkFBNkIsRUFBRTtRQUN6QyxVQUFVLEVBQUUsS0FBSyxDQUFDLFVBQVU7UUFDNUIsUUFBUSxFQUFFLEtBQUssQ0FBQyxRQUFRO1FBQ3hCLEtBQUssRUFBRSxLQUFLLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxLQUFLO1FBQ3pDLGlCQUFpQixFQUFFLEtBQUssQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLGtCQUFrQjtLQUNuRSxDQUFDLENBQUM7SUFFSCx3QkFBd0I7SUFDeEIsS0FBSyxDQUFDLFFBQVEsQ0FBQyxlQUFlLEdBQUcsSUFBSSxDQUFDO0lBRXRDLHdCQUF3QjtJQUN4QixJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3ZDLEtBQUssQ0FBQyxRQUFRLENBQUMsZUFBZSxHQUFHLElBQUksQ0FBQztJQUN4QyxDQUFDO0lBRUQsbUVBQW1FO0lBQ25FLE1BQU0saUJBQWlCLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsa0JBQWtCLENBQUM7SUFFMUUsSUFBSSxpQkFBaUIsRUFBRSxDQUFDO1FBQ3RCLElBQUksQ0FBQztZQUNILE1BQU0sTUFBTSxHQUFHLE1BQU0sU0FBUyxDQUFDLElBQUksQ0FDakMsSUFBSSx5QkFBVSxDQUFDO2dCQUNiLFNBQVMsRUFBRSxlQUFlO2dCQUMxQixHQUFHLEVBQUU7b0JBQ0gsUUFBUSxFQUFFLGlCQUFpQixDQUFDLFdBQVcsRUFBRSxDQUFDLElBQUksRUFBRTtpQkFDakQ7YUFDRixDQUFDLENBQ0gsQ0FBQztZQUVGLDRDQUE0QztZQUM1QyxJQUFJLE1BQU0sQ0FBQyxJQUFJLEVBQUUsQ0FBQztnQkFDaEIsT0FBTyxDQUFDLEtBQUssQ0FBQyx5QkFBeUIsRUFBRSxFQUFFLFFBQVEsRUFBRSxpQkFBaUIsRUFBRSxDQUFDLENBQUM7Z0JBQzFFLE1BQU0sSUFBSSxLQUFLLENBQUMscUNBQXFDLENBQUMsQ0FBQztZQUN6RCxDQUFDO1lBRUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxvQkFBb0IsRUFBRSxFQUFFLFFBQVEsRUFBRSxpQkFBaUIsRUFBRSxDQUFDLENBQUM7UUFDckUsQ0FBQztRQUFDLE9BQU8sS0FBVSxFQUFFLENBQUM7WUFDcEIsSUFBSSxLQUFLLENBQUMsT0FBTyxLQUFLLHFDQUFxQyxFQUFFLENBQUM7Z0JBQzVELE1BQU0sS0FBSyxDQUFDO1lBQ2QsQ0FBQztZQUVELE9BQU8sQ0FBQyxLQUFLLENBQUMsdUNBQXVDLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDOUQsa0RBQWtEO1FBQ3BELENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxxQkFBcUIsRUFBRTtRQUNqQyxRQUFRLEVBQUUsS0FBSyxDQUFDLFFBQVE7UUFDeEIsZUFBZSxFQUFFLEtBQUssQ0FBQyxRQUFRLENBQUMsZUFBZTtRQUMvQyxlQUFlLEVBQUUsS0FBSyxDQUFDLFFBQVEsQ0FBQyxlQUFlO0tBQ2hELENBQUMsQ0FBQztJQUVILE9BQU8sS0FBSyxDQUFDO0FBQ2YsQ0FBQyxDQUFDO0FBeERXLFFBQUEsT0FBTyxXQXdEbEIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBQcmVTaWduVXBUcmlnZ2VyRXZlbnQsIFByZVNpZ25VcFRyaWdnZXJIYW5kbGVyIH0gZnJvbSAnYXdzLWxhbWJkYSc7XHJcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcclxuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCwgR2V0Q29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XHJcblxyXG5jb25zdCBjbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoe30pO1xyXG5jb25zdCBkb2NDbGllbnQgPSBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20oY2xpZW50KTtcclxuXHJcbmNvbnN0IFVTRVJOQU1FU19UQUJMRSA9IHByb2Nlc3MuZW52LlVTRVJOQU1FU19UQUJMRSB8fCAndHJpbml0eS11c2VybmFtZXMnO1xyXG5cclxuLyoqXHJcbiAqIENvZ25pdG8gUHJlIFNpZ24tdXAgVHJpZ2dlclxyXG4gKiBBdXRvLWNvbmZpcm1zIHVzZXJzIGFuZCB0aGVpciBlbWFpbCBhZGRyZXNzZXNcclxuICogVmFsaWRhdGVzIHVzZXJuYW1lIGF2YWlsYWJpbGl0eSAoZG9lcyBOT1Qgc3RvcmUgaXQgeWV0KVxyXG4gKi9cclxuZXhwb3J0IGNvbnN0IGhhbmRsZXI6IFByZVNpZ25VcFRyaWdnZXJIYW5kbGVyID0gYXN5bmMgKFxyXG4gIGV2ZW50OiBQcmVTaWduVXBUcmlnZ2VyRXZlbnRcclxuKTogUHJvbWlzZTxQcmVTaWduVXBUcmlnZ2VyRXZlbnQ+ID0+IHtcclxuICBjb25zb2xlLmxvZygnUHJlIFNpZ24tdXAgVHJpZ2dlciBpbnZva2VkJywge1xyXG4gICAgdXNlclBvb2xJZDogZXZlbnQudXNlclBvb2xJZCxcclxuICAgIHVzZXJOYW1lOiBldmVudC51c2VyTmFtZSxcclxuICAgIGVtYWlsOiBldmVudC5yZXF1ZXN0LnVzZXJBdHRyaWJ1dGVzLmVtYWlsLFxyXG4gICAgcHJlZmVycmVkVXNlcm5hbWU6IGV2ZW50LnJlcXVlc3QudXNlckF0dHJpYnV0ZXMucHJlZmVycmVkX3VzZXJuYW1lLFxyXG4gIH0pO1xyXG5cclxuICAvLyBBdXRvLWNvbmZpcm0gdGhlIHVzZXJcclxuICBldmVudC5yZXNwb25zZS5hdXRvQ29uZmlybVVzZXIgPSB0cnVlO1xyXG5cclxuICAvLyBBdXRvLXZlcmlmeSB0aGUgZW1haWxcclxuICBpZiAoZXZlbnQucmVxdWVzdC51c2VyQXR0cmlidXRlcy5lbWFpbCkge1xyXG4gICAgZXZlbnQucmVzcG9uc2UuYXV0b1ZlcmlmeUVtYWlsID0gdHJ1ZTtcclxuICB9XHJcblxyXG4gIC8vIFZhbGlkYXRlIHVzZXJuYW1lIGF2YWlsYWJpbGl0eSBpZiBwcmVmZXJyZWRfdXNlcm5hbWUgaXMgcHJvdmlkZWRcclxuICBjb25zdCBwcmVmZXJyZWRVc2VybmFtZSA9IGV2ZW50LnJlcXVlc3QudXNlckF0dHJpYnV0ZXMucHJlZmVycmVkX3VzZXJuYW1lO1xyXG5cclxuICBpZiAocHJlZmVycmVkVXNlcm5hbWUpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKFxyXG4gICAgICAgIG5ldyBHZXRDb21tYW5kKHtcclxuICAgICAgICAgIFRhYmxlTmFtZTogVVNFUk5BTUVTX1RBQkxFLFxyXG4gICAgICAgICAgS2V5OiB7XHJcbiAgICAgICAgICAgIHVzZXJuYW1lOiBwcmVmZXJyZWRVc2VybmFtZS50b0xvd2VyQ2FzZSgpLnRyaW0oKSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfSlcclxuICAgICAgKTtcclxuXHJcbiAgICAgIC8vIElmIHVzZXJuYW1lIGV4aXN0cywgZmFpbCB0aGUgcmVnaXN0cmF0aW9uXHJcbiAgICAgIGlmIChyZXN1bHQuSXRlbSkge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ1VzZXJuYW1lIGFscmVhZHkgZXhpc3RzJywgeyB1c2VybmFtZTogcHJlZmVycmVkVXNlcm5hbWUgfSk7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFbCBub21icmUgZGUgdXN1YXJpbyB5YSBlc3TDoSBlbiB1c28nKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc29sZS5sb2coJ1VzZXJuYW1lIGF2YWlsYWJsZScsIHsgdXNlcm5hbWU6IHByZWZlcnJlZFVzZXJuYW1lIH0pO1xyXG4gICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xyXG4gICAgICBpZiAoZXJyb3IubWVzc2FnZSA9PT0gJ0VsIG5vbWJyZSBkZSB1c3VhcmlvIHlhIGVzdMOhIGVuIHVzbycpIHtcclxuICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIGNoZWNrIHVzZXJuYW1lIGF2YWlsYWJpbGl0eScsIGVycm9yKTtcclxuICAgICAgLy8gRG9uJ3QgZmFpbCByZWdpc3RyYXRpb24gaWYgRHluYW1vREIgY2hlY2sgZmFpbHNcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGNvbnNvbGUubG9nKCdVc2VyIGF1dG8tY29uZmlybWVkJywge1xyXG4gICAgdXNlck5hbWU6IGV2ZW50LnVzZXJOYW1lLFxyXG4gICAgYXV0b0NvbmZpcm1Vc2VyOiBldmVudC5yZXNwb25zZS5hdXRvQ29uZmlybVVzZXIsXHJcbiAgICBhdXRvVmVyaWZ5RW1haWw6IGV2ZW50LnJlc3BvbnNlLmF1dG9WZXJpZnlFbWFpbCxcclxuICB9KTtcclxuXHJcbiAgcmV0dXJuIGV2ZW50O1xyXG59O1xyXG4iXX0=