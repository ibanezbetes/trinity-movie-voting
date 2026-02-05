"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrinityStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const dynamodb = __importStar(require("aws-cdk-lib/aws-dynamodb"));
const appsync = __importStar(require("aws-cdk-lib/aws-appsync"));
const cognito = __importStar(require("aws-cdk-lib/aws-cognito"));
const path = __importStar(require("path"));
class TrinityStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // DynamoDB Tables
        const roomsTable = new dynamodb.Table(this, 'RoomsTable', {
            tableName: 'trinity-rooms',
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            timeToLiveAttribute: 'ttl',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // Add GSI for room code lookup (first deployment)
        roomsTable.addGlobalSecondaryIndex({
            indexName: 'code-index',
            partitionKey: { name: 'code', type: dynamodb.AttributeType.STRING },
        });
        const votesTable = new dynamodb.Table(this, 'VotesTable', {
            tableName: 'trinity-votes',
            partitionKey: { name: 'roomId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'userMovieId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        const matchesTable = new dynamodb.Table(this, 'MatchesTable', {
            tableName: 'trinity-matches',
            partitionKey: { name: 'roomId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'movieId', type: dynamodb.AttributeType.NUMBER },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // Cognito User Pool
        const userPool = new cognito.UserPool(this, 'TrinityUserPool', {
            userPoolName: 'trinity-users',
            selfSignUpEnabled: true,
            signInAliases: {
                email: true,
            },
            autoVerify: {
                email: true,
            },
            passwordPolicy: {
                minLength: 8,
                requireLowercase: true,
                requireUppercase: true,
                requireDigits: true,
                requireSymbols: false,
            },
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        const userPoolClient = new cognito.UserPoolClient(this, 'TrinityUserPoolClient', {
            userPool,
            userPoolClientName: 'trinity-client',
            generateSecret: false,
            authFlows: {
                userPassword: true,
                userSrp: true,
            },
        });
        // GraphQL API
        const api = new appsync.GraphqlApi(this, 'TrinityApi', {
            name: 'trinity-api',
            definition: appsync.Definition.fromFile(path.join(__dirname, '../schema.graphql')),
            authorizationConfig: {
                defaultAuthorization: {
                    authorizationType: appsync.AuthorizationType.USER_POOL,
                    userPoolConfig: {
                        userPool,
                    },
                },
                additionalAuthorizationModes: [
                    {
                        authorizationType: appsync.AuthorizationType.IAM,
                    },
                ],
            },
            logConfig: {
                fieldLogLevel: appsync.FieldLogLevel.ALL,
            },
        });
        // Lambda Functions
        const tmdbHandler = new lambda.Function(this, 'TmdbHandler', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/tmdb')),
            environment: {
                TMDB_API_KEY: process.env.TMDB_API_KEY || 'dc4dbcd2404c1ca852f8eb964add267d', // Fallback hardcoded
                TMDB_READ_TOKEN: process.env.TMDB_READ_TOKEN || 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJkYzRkYmNkMjQwNGMxY2E4NTJmOGViOTY0YWRkMjY3ZCIsIm5iZiI6MTc2NjAwMTAwMi40MDk5OTk4LCJzdWIiOiI2OTQzMDk2YTRjMGMxZmUzZDY3OWFjYmUiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.qK155c8oXB-_OUfYcNedwc7Fsbg8w7Y4d99oikb3SP8',
            },
            timeout: cdk.Duration.seconds(30),
        });
        const roomHandler = new lambda.Function(this, 'RoomHandler', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/room')),
            environment: {
                ROOMS_TABLE: roomsTable.tableName,
                VOTES_TABLE: votesTable.tableName,
                MATCHES_TABLE: matchesTable.tableName,
                TMDB_LAMBDA_ARN: tmdbHandler.functionArn,
            },
            timeout: cdk.Duration.seconds(30),
        });
        const voteHandler = new lambda.Function(this, 'VoteHandler', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/vote')),
            environment: {
                VOTES_TABLE: votesTable.tableName,
                MATCHES_TABLE: matchesTable.tableName,
                ROOMS_TABLE: roomsTable.tableName,
                GRAPHQL_ENDPOINT: api.graphqlUrl,
            },
            timeout: cdk.Duration.seconds(30),
        });
        const matchHandler = new lambda.Function(this, 'MatchHandler', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/match')),
            environment: {
                MATCHES_TABLE: matchesTable.tableName,
                GRAPHQL_ENDPOINT: api.graphqlUrl,
            },
            timeout: cdk.Duration.seconds(30),
        });
        // Grant permissions
        roomsTable.grantReadWriteData(roomHandler);
        votesTable.grantReadWriteData(roomHandler);
        matchesTable.grantReadData(roomHandler);
        votesTable.grantReadWriteData(voteHandler);
        matchesTable.grantReadWriteData(voteHandler);
        matchesTable.grantReadWriteData(matchHandler);
        roomsTable.grantReadData(voteHandler);
        tmdbHandler.grantInvoke(roomHandler);
        // Grant AppSync permissions to Lambda functions
        api.grantMutation(voteHandler, 'publishRoomMatch');
        api.grantMutation(voteHandler, 'publishUserMatch');
        api.grantMutation(matchHandler, 'publishRoomMatch');
        api.grantMutation(matchHandler, 'publishUserMatch');
        // Data Sources
        const tmdbDataSource = api.addLambdaDataSource('TmdbDataSource', tmdbHandler);
        const roomDataSource = api.addLambdaDataSource('RoomDataSource', roomHandler);
        const voteDataSource = api.addLambdaDataSource('VoteDataSource', voteHandler);
        const matchDataSource = api.addLambdaDataSource('MatchDataSource', matchHandler);
        // Resolvers
        roomDataSource.createResolver('CreateRoomResolver', {
            typeName: 'Mutation',
            fieldName: 'createRoom',
        });
        roomDataSource.createResolver('JoinRoomResolver', {
            typeName: 'Mutation',
            fieldName: 'joinRoom',
        });
        roomDataSource.createResolver('GetRoomResolver', {
            typeName: 'Query',
            fieldName: 'getRoom',
        });
        roomDataSource.createResolver('GetMyRoomsResolver', {
            typeName: 'Query',
            fieldName: 'getMyRooms',
        });
        voteDataSource.createResolver('VoteResolver', {
            typeName: 'Mutation',
            fieldName: 'vote',
        });
        matchDataSource.createResolver('GetMyMatchesResolver', {
            typeName: 'Query',
            fieldName: 'getMyMatches',
        });
        // Subscription resolvers (no-op resolvers for triggering subscriptions)
        api.createResolver('PublishRoomMatchResolver', {
            typeName: 'Mutation',
            fieldName: 'publishRoomMatch',
            dataSource: api.addNoneDataSource('NoneDataSource'),
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "payload": $util.toJson($context.arguments)
        }
      `),
            responseMappingTemplate: appsync.MappingTemplate.fromString(`
        $util.toJson($context.result)
      `),
        });
        api.createResolver('PublishUserMatchResolver', {
            typeName: 'Mutation',
            fieldName: 'publishUserMatch',
            dataSource: api.addNoneDataSource('NoneDataSource2'),
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "payload": $util.toJson($context.arguments)
        }
      `),
            responseMappingTemplate: appsync.MappingTemplate.fromString(`
        $util.toJson($context.result)
      `),
        });
        // Outputs
        new cdk.CfnOutput(this, 'GraphQLEndpoint', {
            value: api.graphqlUrl,
            description: 'GraphQL API Endpoint',
        });
        new cdk.CfnOutput(this, 'GraphQLApiKey', {
            value: api.apiKey || 'N/A',
            description: 'GraphQL API Key',
        });
        new cdk.CfnOutput(this, 'UserPoolId', {
            value: userPool.userPoolId,
            description: 'Cognito User Pool ID',
        });
        new cdk.CfnOutput(this, 'UserPoolClientId', {
            value: userPoolClient.userPoolClientId,
            description: 'Cognito User Pool Client ID',
        });
        new cdk.CfnOutput(this, 'Region', {
            value: this.region,
            description: 'AWS Region',
        });
    }
}
exports.TrinityStack = TrinityStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJpbml0eS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3RyaW5pdHktc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLCtEQUFpRDtBQUNqRCxtRUFBcUQ7QUFDckQsaUVBQW1EO0FBQ25ELGlFQUFtRDtBQUduRCwyQ0FBNkI7QUFHN0IsTUFBYSxZQUFhLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDekMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixrQkFBa0I7UUFDbEIsTUFBTSxVQUFVLEdBQUcsSUFBSSxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUU7WUFDeEQsU0FBUyxFQUFFLGVBQWU7WUFDMUIsWUFBWSxFQUFFLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNLEVBQUU7WUFDakUsV0FBVyxFQUFFLFFBQVEsQ0FBQyxXQUFXLENBQUMsZUFBZTtZQUNqRCxtQkFBbUIsRUFBRSxLQUFLO1lBQzFCLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU87U0FDekMsQ0FBQyxDQUFDO1FBRUgsa0RBQWtEO1FBQ2xELFVBQVUsQ0FBQyx1QkFBdUIsQ0FBQztZQUNqQyxTQUFTLEVBQUUsWUFBWTtZQUN2QixZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRTtTQUNwRSxDQUFDLENBQUM7UUFFSCxNQUFNLFVBQVUsR0FBRyxJQUFJLFFBQVEsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUN4RCxTQUFTLEVBQUUsZUFBZTtZQUMx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RyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDekMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxVQUFVO1lBQ3JCLFdBQVcsRUFBRSxzQkFBc0I7U0FDcEMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDdkMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxNQUFNLElBQUksS0FBSztZQUMxQixXQUFXLEVBQUUsaUJBQWlCO1NBQy9CLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFO1lBQ3BDLEtBQUssRUFBRSxRQUFRLENBQUMsVUFBVTtZQUMxQixXQUFXLEVBQUUsc0JBQXNCO1NBQ3BDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDMUMsS0FBSyxFQUFFLGNBQWMsQ0FBQyxnQkFBZ0I7WUFDdEMsV0FBVyxFQUFFLDZCQUE2QjtTQUMzQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRTtZQUNoQyxLQUFLLEVBQUUsSUFBSSxDQUFDLE1BQU07WUFDbEIsV0FBVyxFQUFFLFlBQVk7U0FDMUIsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBdlBELG9DQXVQQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XHJcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcclxuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcclxuaW1wb3J0ICogYXMgYXBwc3luYyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBwc3luYyc7XHJcbmltcG9ydCAqIGFzIGNvZ25pdG8gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZ25pdG8nO1xyXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xyXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XHJcblxyXG5leHBvcnQgY2xhc3MgVHJpbml0eVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcclxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XHJcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcclxuXHJcbiAgICAvLyBEeW5hbW9EQiBUYWJsZXNcclxuICAgIGNvbnN0IHJvb21zVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1Jvb21zVGFibGUnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogJ3RyaW5pdHktcm9vbXMnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogJ3R0bCcsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBZGQgR1NJIGZvciByb29tIGNvZGUgbG9va3VwIChmaXJzdCBkZXBsb3ltZW50KVxyXG4gICAgcm9vbXNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ2NvZGUtaW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2NvZGUnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3Qgdm90ZXNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnVm90ZXNUYWJsZScsIHtcclxuICAgICAgdGFibGVOYW1lOiAndHJpbml0eS12b3RlcycsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAncm9vbUlkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAndXNlck1vdmllSWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgbWF0Y2hlc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdNYXRjaGVzVGFibGUnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogJ3RyaW5pdHktbWF0Y2hlcycsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAncm9vbUlkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAnbW92aWVJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuTlVNQkVSIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBDb2duaXRvIFVzZXIgUG9vbFxyXG4gICAgY29uc3QgdXNlclBvb2wgPSBuZXcgY29nbml0by5Vc2VyUG9vbCh0aGlzLCAnVHJpbml0eVVzZXJQb29sJywge1xyXG4gICAgICB1c2VyUG9vbE5hbWU6ICd0cmluaXR5LXVzZXJzJyxcclxuICAgICAgc2VsZlNpZ25VcEVuYWJsZWQ6IHRydWUsXHJcbiAgICAgIHNpZ25JbkFsaWFzZXM6IHtcclxuICAgICAgICBlbWFpbDogdHJ1ZSxcclxuICAgICAgfSxcclxuICAgICAgYXV0b1ZlcmlmeToge1xyXG4gICAgICAgIGVtYWlsOiB0cnVlLFxyXG4gICAgICB9LFxyXG4gICAgICBwYXNzd29yZFBvbGljeToge1xyXG4gICAgICAgIG1pbkxlbmd0aDogOCxcclxuICAgICAgICByZXF1aXJlTG93ZXJjYXNlOiB0cnVlLFxyXG4gICAgICAgIHJlcXVpcmVVcHBlcmNhc2U6IHRydWUsXHJcbiAgICAgICAgcmVxdWlyZURpZ2l0czogdHJ1ZSxcclxuICAgICAgICByZXF1aXJlU3ltYm9sczogZmFsc2UsXHJcbiAgICAgIH0sXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCB1c2VyUG9vbENsaWVudCA9IG5ldyBjb2duaXRvLlVzZXJQb29sQ2xpZW50KHRoaXMsICdUcmluaXR5VXNlclBvb2xDbGllbnQnLCB7XHJcbiAgICAgIHVzZXJQb29sLFxyXG4gICAgICB1c2VyUG9vbENsaWVudE5hbWU6ICd0cmluaXR5LWNsaWVudCcsXHJcbiAgICAgIGdlbmVyYXRlU2VjcmV0OiBmYWxzZSxcclxuICAgICAgYXV0aEZsb3dzOiB7XHJcbiAgICAgICAgdXNlclBhc3N3b3JkOiB0cnVlLFxyXG4gICAgICAgIHVzZXJTcnA6IHRydWUsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHcmFwaFFMIEFQSVxyXG4gICAgY29uc3QgYXBpID0gbmV3IGFwcHN5bmMuR3JhcGhxbEFwaSh0aGlzLCAnVHJpbml0eUFwaScsIHtcclxuICAgICAgbmFtZTogJ3RyaW5pdHktYXBpJyxcclxuICAgICAgZGVmaW5pdGlvbjogYXBwc3luYy5EZWZpbml0aW9uLmZyb21GaWxlKHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9zY2hlbWEuZ3JhcGhxbCcpKSxcclxuICAgICAgYXV0aG9yaXphdGlvbkNvbmZpZzoge1xyXG4gICAgICAgIGRlZmF1bHRBdXRob3JpemF0aW9uOiB7XHJcbiAgICAgICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBwc3luYy5BdXRob3JpemF0aW9uVHlwZS5VU0VSX1BPT0wsXHJcbiAgICAgICAgICB1c2VyUG9vbENvbmZpZzoge1xyXG4gICAgICAgICAgICB1c2VyUG9vbCxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfSxcclxuICAgICAgICBhZGRpdGlvbmFsQXV0aG9yaXphdGlvbk1vZGVzOiBbXHJcbiAgICAgICAgICB7XHJcbiAgICAgICAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcHBzeW5jLkF1dGhvcml6YXRpb25UeXBlLklBTSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgXSxcclxuICAgICAgfSxcclxuICAgICAgbG9nQ29uZmlnOiB7XHJcbiAgICAgICAgZmllbGRMb2dMZXZlbDogYXBwc3luYy5GaWVsZExvZ0xldmVsLkFMTCxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIExhbWJkYSBGdW5jdGlvbnNcclxuICAgIGNvbnN0IHRtZGJIYW5kbGVyID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnVG1kYkhhbmRsZXInLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vc3JjL2hhbmRsZXJzL3RtZGInKSksXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgVE1EQl9BUElfS0VZOiBwcm9jZXNzLmVudi5UTURCX0FQSV9LRVkgfHwgJ2RjNGRiY2QyNDA0YzFjYTg1MmY4ZWI5NjRhZGQyNjdkJywgLy8gRmFsbGJhY2sgaGFyZGNvZGVkXHJcbiAgICAgICAgVE1EQl9SRUFEX1RPS0VOOiBwcm9jZXNzLmVudi5UTURCX1JFQURfVE9LRU4gfHwgJ2V5SmhiR2NpT2lKSVV6STFOaUo5LmV5SmhkV1FpT2lKa1l6UmtZbU5rTWpRd05HTXhZMkU0TlRKbU9HVmlPVFkwWVdSa01qWTNaQ0lzSW01aVppSTZNVGMyTmpBd01UQXdNaTQwTURrNU9UazRMQ0p6ZFdJaU9pSTJPVFF6TURrMllUUmpNR014Wm1VelpEWTNPV0ZqWW1VaUxDSnpZMjl3WlhNaU9sc2lZWEJwWDNKbFlXUWlYU3dpZG1WeWMybHZiaUk2TVgwLnFLMTU1YzhvWEItX09VZlljTmVkd2M3RnNiZzh3N1k0ZDk5b2lrYjNTUDgnLFxyXG4gICAgICB9LFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCByb29tSGFuZGxlciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1Jvb21IYW5kbGVyJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3NyYy9oYW5kbGVycy9yb29tJykpLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIFJPT01TX1RBQkxFOiByb29tc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBWT1RFU19UQUJMRTogdm90ZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgTUFUQ0hFU19UQUJMRTogbWF0Y2hlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBUTURCX0xBTUJEQV9BUk46IHRtZGJIYW5kbGVyLmZ1bmN0aW9uQXJuLFxyXG4gICAgICB9LFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCB2b3RlSGFuZGxlciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1ZvdGVIYW5kbGVyJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3NyYy9oYW5kbGVycy92b3RlJykpLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIFZPVEVTX1RBQkxFOiB2b3Rlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBNQVRDSEVTX1RBQkxFOiBtYXRjaGVzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIFJPT01TX1RBQkxFOiByb29tc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBHUkFQSFFMX0VORFBPSU5UOiBhcGkuZ3JhcGhxbFVybCxcclxuICAgICAgfSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgbWF0Y2hIYW5kbGVyID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnTWF0Y2hIYW5kbGVyJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3NyYy9oYW5kbGVycy9tYXRjaCcpKSxcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBNQVRDSEVTX1RBQkxFOiBtYXRjaGVzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIEdSQVBIUUxfRU5EUE9JTlQ6IGFwaS5ncmFwaHFsVXJsLFxyXG4gICAgICB9LFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHcmFudCBwZXJtaXNzaW9uc1xyXG4gICAgcm9vbXNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEocm9vbUhhbmRsZXIpO1xyXG4gICAgdm90ZXNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEocm9vbUhhbmRsZXIpO1xyXG4gICAgbWF0Y2hlc1RhYmxlLmdyYW50UmVhZERhdGEocm9vbUhhbmRsZXIpO1xyXG4gICAgdm90ZXNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEodm90ZUhhbmRsZXIpO1xyXG4gICAgbWF0Y2hlc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YSh2b3RlSGFuZGxlcik7XHJcbiAgICBtYXRjaGVzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKG1hdGNoSGFuZGxlcik7XHJcbiAgICByb29tc1RhYmxlLmdyYW50UmVhZERhdGEodm90ZUhhbmRsZXIpO1xyXG5cclxuICAgIHRtZGJIYW5kbGVyLmdyYW50SW52b2tlKHJvb21IYW5kbGVyKTtcclxuXHJcbiAgICAvLyBHcmFudCBBcHBTeW5jIHBlcm1pc3Npb25zIHRvIExhbWJkYSBmdW5jdGlvbnNcclxuICAgIGFwaS5ncmFudE11dGF0aW9uKHZvdGVIYW5kbGVyLCAncHVibGlzaFJvb21NYXRjaCcpO1xyXG4gICAgYXBpLmdyYW50TXV0YXRpb24odm90ZUhhbmRsZXIsICdwdWJsaXNoVXNlck1hdGNoJyk7XHJcbiAgICBhcGkuZ3JhbnRNdXRhdGlvbihtYXRjaEhhbmRsZXIsICdwdWJsaXNoUm9vbU1hdGNoJyk7XHJcbiAgICBhcGkuZ3JhbnRNdXRhdGlvbihtYXRjaEhhbmRsZXIsICdwdWJsaXNoVXNlck1hdGNoJyk7XHJcblxyXG4gICAgLy8gRGF0YSBTb3VyY2VzXHJcbiAgICBjb25zdCB0bWRiRGF0YVNvdXJjZSA9IGFwaS5hZGRMYW1iZGFEYXRhU291cmNlKCdUbWRiRGF0YVNvdXJjZScsIHRtZGJIYW5kbGVyKTtcclxuICAgIGNvbnN0IHJvb21EYXRhU291cmNlID0gYXBpLmFkZExhbWJkYURhdGFTb3VyY2UoJ1Jvb21EYXRhU291cmNlJywgcm9vbUhhbmRsZXIpO1xyXG4gICAgY29uc3Qgdm90ZURhdGFTb3VyY2UgPSBhcGkuYWRkTGFtYmRhRGF0YVNvdXJjZSgnVm90ZURhdGFTb3VyY2UnLCB2b3RlSGFuZGxlcik7XHJcbiAgICBjb25zdCBtYXRjaERhdGFTb3VyY2UgPSBhcGkuYWRkTGFtYmRhRGF0YVNvdXJjZSgnTWF0Y2hEYXRhU291cmNlJywgbWF0Y2hIYW5kbGVyKTtcclxuXHJcbiAgICAvLyBSZXNvbHZlcnNcclxuICAgIHJvb21EYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdDcmVhdGVSb29tUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnTXV0YXRpb24nLFxyXG4gICAgICBmaWVsZE5hbWU6ICdjcmVhdGVSb29tJyxcclxuICAgIH0pO1xyXG5cclxuICAgIHJvb21EYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdKb2luUm9vbVJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ011dGF0aW9uJyxcclxuICAgICAgZmllbGROYW1lOiAnam9pblJvb20nLFxyXG4gICAgfSk7XHJcblxyXG4gICAgcm9vbURhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0dldFJvb21SZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdRdWVyeScsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2dldFJvb20nLFxyXG4gICAgfSk7XHJcblxyXG4gICAgcm9vbURhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0dldE15Um9vbXNSZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdRdWVyeScsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2dldE15Um9vbXMnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgdm90ZURhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ1ZvdGVSZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdNdXRhdGlvbicsXHJcbiAgICAgIGZpZWxkTmFtZTogJ3ZvdGUnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbWF0Y2hEYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdHZXRNeU1hdGNoZXNSZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdRdWVyeScsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2dldE15TWF0Y2hlcycsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBTdWJzY3JpcHRpb24gcmVzb2x2ZXJzIChuby1vcCByZXNvbHZlcnMgZm9yIHRyaWdnZXJpbmcgc3Vic2NyaXB0aW9ucylcclxuICAgIGFwaS5jcmVhdGVSZXNvbHZlcignUHVibGlzaFJvb21NYXRjaFJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ011dGF0aW9uJyxcclxuICAgICAgZmllbGROYW1lOiAncHVibGlzaFJvb21NYXRjaCcsXHJcbiAgICAgIGRhdGFTb3VyY2U6IGFwaS5hZGROb25lRGF0YVNvdXJjZSgnTm9uZURhdGFTb3VyY2UnKSxcclxuICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgXCJ2ZXJzaW9uXCI6IFwiMjAxNy0wMi0yOFwiLFxyXG4gICAgICAgICAgXCJwYXlsb2FkXCI6ICR1dGlsLnRvSnNvbigkY29udGV4dC5hcmd1bWVudHMpXHJcbiAgICAgICAgfVxyXG4gICAgICBgKSxcclxuICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgICR1dGlsLnRvSnNvbigkY29udGV4dC5yZXN1bHQpXHJcbiAgICAgIGApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgYXBpLmNyZWF0ZVJlc29sdmVyKCdQdWJsaXNoVXNlck1hdGNoUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnTXV0YXRpb24nLFxyXG4gICAgICBmaWVsZE5hbWU6ICdwdWJsaXNoVXNlck1hdGNoJyxcclxuICAgICAgZGF0YVNvdXJjZTogYXBpLmFkZE5vbmVEYXRhU291cmNlKCdOb25lRGF0YVNvdXJjZTInKSxcclxuICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgXCJ2ZXJzaW9uXCI6IFwiMjAxNy0wMi0yOFwiLFxyXG4gICAgICAgICAgXCJwYXlsb2FkXCI6ICR1dGlsLnRvSnNvbigkY29udGV4dC5hcmd1bWVudHMpXHJcbiAgICAgICAgfVxyXG4gICAgICBgKSxcclxuICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgICR1dGlsLnRvSnNvbigkY29udGV4dC5yZXN1bHQpXHJcbiAgICAgIGApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gT3V0cHV0c1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0dyYXBoUUxFbmRwb2ludCcsIHtcclxuICAgICAgdmFsdWU6IGFwaS5ncmFwaHFsVXJsLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0dyYXBoUUwgQVBJIEVuZHBvaW50JyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdHcmFwaFFMQXBpS2V5Jywge1xyXG4gICAgICB2YWx1ZTogYXBpLmFwaUtleSB8fCAnTi9BJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdHcmFwaFFMIEFQSSBLZXknLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sSWQnLCB7XHJcbiAgICAgIHZhbHVlOiB1c2VyUG9vbC51c2VyUG9vbElkLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZ25pdG8gVXNlciBQb29sIElEJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVc2VyUG9vbENsaWVudElkJywge1xyXG4gICAgICB2YWx1ZTogdXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZCxcclxuICAgICAgZGVzY3JpcHRpb246ICdDb2duaXRvIFVzZXIgUG9vbCBDbGllbnQgSUQnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1JlZ2lvbicsIHtcclxuICAgICAgdmFsdWU6IHRoaXMucmVnaW9uLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0FXUyBSZWdpb24nLFxyXG4gICAgfSk7XHJcbiAgfVxyXG59Il19