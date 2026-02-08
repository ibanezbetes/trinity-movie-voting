"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client = new client_dynamodb_1.DynamoDBClient({});
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(client);
const USERNAMES_TABLE = process.env.USERNAMES_TABLE || 'trinity-usernames';
/**
 * Cognito Post Confirmation Trigger
 * Stores username -> email mapping in DynamoDB after successful user creation
 */
const handler = async (event) => {
    console.log('Post Confirmation Trigger invoked', {
        userPoolId: event.userPoolId,
        userName: event.userName,
        email: event.request.userAttributes.email,
        preferredUsername: event.request.userAttributes.preferred_username,
        triggerSource: event.triggerSource,
    });
    // Store username -> email mapping if preferred_username is provided
    const preferredUsername = event.request.userAttributes.preferred_username;
    const email = event.request.userAttributes.email;
    if (preferredUsername && email) {
        try {
            await docClient.send(new lib_dynamodb_1.PutCommand({
                TableName: USERNAMES_TABLE,
                Item: {
                    username: preferredUsername.toLowerCase().trim(),
                    email: email.toLowerCase().trim(),
                    createdAt: new Date().toISOString(),
                },
                // Prevent overwriting existing username (should not happen, but just in case)
                ConditionExpression: 'attribute_not_exists(username)',
            }));
            console.log('Username mapping stored successfully', {
                username: preferredUsername,
                email: email,
            });
        }
        catch (error) {
            console.error('Failed to store username mapping', error);
            // Don't fail the confirmation if DynamoDB fails
            // User is already created in Cognito at this point
        }
    }
    return event;
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicG9zdC1jb25maXJtYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvY29nbml0by10cmlnZ2Vycy9wb3N0LWNvbmZpcm1hdGlvbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBMEQ7QUFDMUQsd0RBQTJFO0FBRTNFLE1BQU0sTUFBTSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUN0QyxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7QUFFdEQsTUFBTSxlQUFlLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxlQUFlLElBQUksbUJBQW1CLENBQUM7QUFFM0U7OztHQUdHO0FBQ0ksTUFBTSxPQUFPLEdBQW1DLEtBQUssRUFDMUQsS0FBbUMsRUFDSSxFQUFFO0lBQ3pDLE9BQU8sQ0FBQyxHQUFHLENBQUMsbUNBQW1DLEVBQUU7UUFDL0MsVUFBVSxFQUFFLEtBQUssQ0FBQyxVQUFVO1FBQzVCLFFBQVEsRUFBRSxLQUFLLENBQUMsUUFBUTtRQUN4QixLQUFLLEVBQUUsS0FBSyxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsS0FBSztRQUN6QyxpQkFBaUIsRUFBRSxLQUFLLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxrQkFBa0I7UUFDbEUsYUFBYSxFQUFFLEtBQUssQ0FBQyxhQUFhO0tBQ25DLENBQUMsQ0FBQztJQUVILG9FQUFvRTtJQUNwRSxNQUFNLGlCQUFpQixHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLGtCQUFrQixDQUFDO0lBQzFFLE1BQU0sS0FBSyxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLEtBQUssQ0FBQztJQUVqRCxJQUFJLGlCQUFpQixJQUFJLEtBQUssRUFBRSxDQUFDO1FBQy9CLElBQUksQ0FBQztZQUNILE1BQU0sU0FBUyxDQUFDLElBQUksQ0FDbEIsSUFBSSx5QkFBVSxDQUFDO2dCQUNiLFNBQVMsRUFBRSxlQUFlO2dCQUMxQixJQUFJLEVBQUU7b0JBQ0osUUFBUSxFQUFFLGlCQUFpQixDQUFDLFdBQVcsRUFBRSxDQUFDLElBQUksRUFBRTtvQkFDaEQsS0FBSyxFQUFFLEtBQUssQ0FBQyxXQUFXLEVBQUUsQ0FBQyxJQUFJLEVBQUU7b0JBQ2pDLFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRTtpQkFDcEM7Z0JBQ0QsOEVBQThFO2dCQUM5RSxtQkFBbUIsRUFBRSxnQ0FBZ0M7YUFDdEQsQ0FBQyxDQUNILENBQUM7WUFFRixPQUFPLENBQUMsR0FBRyxDQUFDLHNDQUFzQyxFQUFFO2dCQUNsRCxRQUFRLEVBQUUsaUJBQWlCO2dCQUMzQixLQUFLLEVBQUUsS0FBSzthQUNiLENBQUMsQ0FBQztRQUNMLENBQUM7UUFBQyxPQUFPLEtBQVUsRUFBRSxDQUFDO1lBQ3BCLE9BQU8sQ0FBQyxLQUFLLENBQUMsa0NBQWtDLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDekQsZ0RBQWdEO1lBQ2hELG1EQUFtRDtRQUNyRCxDQUFDO0lBQ0gsQ0FBQztJQUVELE9BQU8sS0FBSyxDQUFDO0FBQ2YsQ0FBQyxDQUFDO0FBMUNXLFFBQUEsT0FBTyxXQTBDbEIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBQb3N0Q29uZmlybWF0aW9uVHJpZ2dlckV2ZW50LCBQb3N0Q29uZmlybWF0aW9uVHJpZ2dlckhhbmRsZXIgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCBQdXRDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvbGliLWR5bmFtb2RiJztcclxuXHJcbmNvbnN0IGNsaWVudCA9IG5ldyBEeW5hbW9EQkNsaWVudCh7fSk7XHJcbmNvbnN0IGRvY0NsaWVudCA9IER5bmFtb0RCRG9jdW1lbnRDbGllbnQuZnJvbShjbGllbnQpO1xyXG5cclxuY29uc3QgVVNFUk5BTUVTX1RBQkxFID0gcHJvY2Vzcy5lbnYuVVNFUk5BTUVTX1RBQkxFIHx8ICd0cmluaXR5LXVzZXJuYW1lcyc7XHJcblxyXG4vKipcclxuICogQ29nbml0byBQb3N0IENvbmZpcm1hdGlvbiBUcmlnZ2VyXHJcbiAqIFN0b3JlcyB1c2VybmFtZSAtPiBlbWFpbCBtYXBwaW5nIGluIER5bmFtb0RCIGFmdGVyIHN1Y2Nlc3NmdWwgdXNlciBjcmVhdGlvblxyXG4gKi9cclxuZXhwb3J0IGNvbnN0IGhhbmRsZXI6IFBvc3RDb25maXJtYXRpb25UcmlnZ2VySGFuZGxlciA9IGFzeW5jIChcclxuICBldmVudDogUG9zdENvbmZpcm1hdGlvblRyaWdnZXJFdmVudFxyXG4pOiBQcm9taXNlPFBvc3RDb25maXJtYXRpb25UcmlnZ2VyRXZlbnQ+ID0+IHtcclxuICBjb25zb2xlLmxvZygnUG9zdCBDb25maXJtYXRpb24gVHJpZ2dlciBpbnZva2VkJywge1xyXG4gICAgdXNlclBvb2xJZDogZXZlbnQudXNlclBvb2xJZCxcclxuICAgIHVzZXJOYW1lOiBldmVudC51c2VyTmFtZSxcclxuICAgIGVtYWlsOiBldmVudC5yZXF1ZXN0LnVzZXJBdHRyaWJ1dGVzLmVtYWlsLFxyXG4gICAgcHJlZmVycmVkVXNlcm5hbWU6IGV2ZW50LnJlcXVlc3QudXNlckF0dHJpYnV0ZXMucHJlZmVycmVkX3VzZXJuYW1lLFxyXG4gICAgdHJpZ2dlclNvdXJjZTogZXZlbnQudHJpZ2dlclNvdXJjZSxcclxuICB9KTtcclxuXHJcbiAgLy8gU3RvcmUgdXNlcm5hbWUgLT4gZW1haWwgbWFwcGluZyBpZiBwcmVmZXJyZWRfdXNlcm5hbWUgaXMgcHJvdmlkZWRcclxuICBjb25zdCBwcmVmZXJyZWRVc2VybmFtZSA9IGV2ZW50LnJlcXVlc3QudXNlckF0dHJpYnV0ZXMucHJlZmVycmVkX3VzZXJuYW1lO1xyXG4gIGNvbnN0IGVtYWlsID0gZXZlbnQucmVxdWVzdC51c2VyQXR0cmlidXRlcy5lbWFpbDtcclxuXHJcbiAgaWYgKHByZWZlcnJlZFVzZXJuYW1lICYmIGVtYWlsKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChcclxuICAgICAgICBuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgICAgICBUYWJsZU5hbWU6IFVTRVJOQU1FU19UQUJMRSxcclxuICAgICAgICAgIEl0ZW06IHtcclxuICAgICAgICAgICAgdXNlcm5hbWU6IHByZWZlcnJlZFVzZXJuYW1lLnRvTG93ZXJDYXNlKCkudHJpbSgpLFxyXG4gICAgICAgICAgICBlbWFpbDogZW1haWwudG9Mb3dlckNhc2UoKS50cmltKCksXHJcbiAgICAgICAgICAgIGNyZWF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIC8vIFByZXZlbnQgb3ZlcndyaXRpbmcgZXhpc3RpbmcgdXNlcm5hbWUgKHNob3VsZCBub3QgaGFwcGVuLCBidXQganVzdCBpbiBjYXNlKVxyXG4gICAgICAgICAgQ29uZGl0aW9uRXhwcmVzc2lvbjogJ2F0dHJpYnV0ZV9ub3RfZXhpc3RzKHVzZXJuYW1lKScsXHJcbiAgICAgICAgfSlcclxuICAgICAgKTtcclxuXHJcbiAgICAgIGNvbnNvbGUubG9nKCdVc2VybmFtZSBtYXBwaW5nIHN0b3JlZCBzdWNjZXNzZnVsbHknLCB7XHJcbiAgICAgICAgdXNlcm5hbWU6IHByZWZlcnJlZFVzZXJuYW1lLFxyXG4gICAgICAgIGVtYWlsOiBlbWFpbCxcclxuICAgICAgfSk7XHJcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBzdG9yZSB1c2VybmFtZSBtYXBwaW5nJywgZXJyb3IpO1xyXG4gICAgICAvLyBEb24ndCBmYWlsIHRoZSBjb25maXJtYXRpb24gaWYgRHluYW1vREIgZmFpbHNcclxuICAgICAgLy8gVXNlciBpcyBhbHJlYWR5IGNyZWF0ZWQgaW4gQ29nbml0byBhdCB0aGlzIHBvaW50XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICByZXR1cm4gZXZlbnQ7XHJcbn07XHJcbiJdfQ==