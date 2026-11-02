import sbt._
import Keys._

ThisBuild / scalaVersion := "2.13.14"
ThisBuild / organization := "fixture.wealth.qualification"
ThisBuild / version := "0.0.0-qualification"

val akkaVersion = "2.6.20"

lazy val root = (project in file(".")).settings(
  name := "generated-fund-order-cash-qualification",
  Compile / unmanagedSourceDirectories := Seq(
    baseDirectory.value / "generated" / "main",
    baseDirectory.value / "handwritten" / "main"
  ),
  Compile / unmanagedResourceDirectories := Seq(baseDirectory.value / "handwritten" / "resources"),
  // Preserve/hash the emitter output, but do not qualify its UUID/first-command factory.
  Compile / sources ~= (_.filterNot(_.getName == "FundOrderAggregateFactory.scala")),
  Test / parallelExecution := false,
  Test / fork := false,
  Test / testOptions += Tests.Argument(TestFrameworks.ScalaTest, "-oD"),
  scalacOptions ++= Seq("-deprecation", "-feature", "-unchecked"),
  libraryDependencies ++= Seq(
    "net.imadz" %% "common-core" % "0.2",
    "com.typesafe.akka" %% "akka-actor-typed" % akkaVersion,
    "com.typesafe.akka" %% "akka-cluster-sharding-typed" % akkaVersion,
    "com.typesafe.akka" %% "akka-persistence-typed" % akkaVersion,
    "com.typesafe.akka" %% "akka-serialization-jackson" % akkaVersion,
    "com.typesafe.play" %% "play-json" % "2.9.4",
    "com.typesafe.akka" %% "akka-actor-testkit-typed" % akkaVersion % Test,
    "com.typesafe.akka" %% "akka-persistence-testkit" % akkaVersion % Test,
    "org.scalatest" %% "scalatest" % "3.2.18" % Test
  ),
  initialize := {
    val previous = initialize.value
    require(sys.props("java.specification.version") == "11", "Qualification requires JDK 11")
    previous
  }
)
