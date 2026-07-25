-- CreateTable
CREATE TABLE "McpAuthorizationCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "scopes" TEXT[],
    "resource" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpAuthorizationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpRefreshToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "scopes" TEXT[],
    "resource" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpRefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpOAuthGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "scopes" TEXT[],
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "McpOAuthGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "McpAuthorizationCode_codeHash_key" ON "McpAuthorizationCode"("codeHash");

-- CreateIndex
CREATE INDEX "McpAuthorizationCode_userId_clientId_idx" ON "McpAuthorizationCode"("userId", "clientId");

-- CreateIndex
CREATE INDEX "McpAuthorizationCode_expiresAt_idx" ON "McpAuthorizationCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "McpRefreshToken_tokenHash_key" ON "McpRefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "McpRefreshToken_userId_clientId_idx" ON "McpRefreshToken"("userId", "clientId");

-- CreateIndex
CREATE INDEX "McpRefreshToken_familyId_idx" ON "McpRefreshToken"("familyId");

-- CreateIndex
CREATE INDEX "McpRefreshToken_expiresAt_idx" ON "McpRefreshToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "McpOAuthGrant_userId_clientId_key" ON "McpOAuthGrant"("userId", "clientId");

-- AddForeignKey
ALTER TABLE "McpAuthorizationCode" ADD CONSTRAINT "McpAuthorizationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpRefreshToken" ADD CONSTRAINT "McpRefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpOAuthGrant" ADD CONSTRAINT "McpOAuthGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
