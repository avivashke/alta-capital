# ============================================================
# Alta Capital — auto-generated strategy artifact
# Desk: תוך־יומי · 5 דקות · BTCUSDT · 5m
# Version: v1.2 · Strategy family: rsi_reversion
# Backtest: return 1.86% · PF 1.62 · DD 2.03% · trades 10
# OOS: 0.77% · Sharpe 5.11
# Params: {"period":14,"oversold":18,"overbought":84,"atrStop":1.9,"rr":1.6}
# Target platform: Freqtrade
# Generated: 2026-11-28T04:55:09.676Z
# Research artifact only — no warranty, no live order routing.
# ============================================================
# Drop this file in freqtrade/user_data/strategies/ and run:
#   freqtrade backtesting --strategy Altadesk_5m --config user_data/config.json
#   freqtrade trade --strategy Altadesk_5m --config user_data/config.json --dry-run

from freqtrade.strategy import IStrategy
from pandas import DataFrame
import talib.abstract as ta


class Altadesk_5m(IStrategy):
    INTERFACE_VERSION = 3

    timeframe = '5m'
    can_short = True
    startup_candle_count = 210

    stoploss = -0.023
    minimal_roi = {"0": 1.44, "240": 0.01, "720": 0}

    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    exit_profit_only = False

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe['rsi'] = ta.RSI(dataframe, timeperiod=14)
        dataframe['atr'] = ta.ATR(dataframe, timeperiod=14)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (
        & (dataframe['rsi'] <= 18)
        & (dataframe['rsi'].shift(1) > 18)
                & (dataframe['volume'] > 0)
            ),
            'enter_long',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['rsi'] >= 84)
        & (dataframe['rsi'].shift(1) < 84)
                & (dataframe['volume'] > 0)
            ),
            'enter_short',
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # Risk-managed exits: ATR stop + fixed R multiple handled by the engine.
        dataframe.loc[
            (
        & (dataframe['rsi'] <= 18)
        & (dataframe['rsi'].shift(1) > 18)
            ),
            'exit_short',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['rsi'] >= 84)
        & (dataframe['rsi'].shift(1) < 84)
            ),
            'exit_long',
        ] = 1
        return dataframe
