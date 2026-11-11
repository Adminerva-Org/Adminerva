FROM eclipse-temurin:17-jdk-jammy
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin runner
USER 10001:10001
WORKDIR /workspace
ENTRYPOINT ["/bin/sh","-c","mkdir -p /tmp/classes && javac -encoding UTF-8 -d /tmp/classes $(find /workspace -type f -name '*.java' -print | sort) && exec java -XX:MaxRAMPercentage=65 -cp /tmp/classes \"$MAIN_CLASS\""]
