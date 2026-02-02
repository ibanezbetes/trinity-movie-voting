import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
export declare class TrinityStack extends cdk.Stack {
    userPool: cognito.UserPool;
    userPoolClient: cognito.UserPoolClient;
    api: appsync.GraphqlApi;
    roomsTable: dynamodb.Table;
    votesTable: dynamodb.Table;
    matchesTable: dynamodb.Table;
    usersTable: dynamodb.Table;
    tmdbLambda: lambda.Function;
    roomLambda: lambda.Function;
    voteLambda: lambda.Function;
    matchLambda: lambda.Function;
    constructor(scope: Construct, id: string, props?: cdk.StackProps);
    private createDynamoDBTables;
    private createCognitoUserPool;
    private createAppSyncAPI;
    private createLambdaFunctions;
    private grantDynamoDBPermissions;
    private grantLambdaPermissions;
    private createResolvers;
    private createOutputs;
}
