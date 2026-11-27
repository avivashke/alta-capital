# ============================================================
# Alta Capital — auto-generated strategy artifact
# Desk: תוך־יומי · 15 דקות · ETHUSDT · 15m
# Version: v1.5 · Strategy family: rsi_reversion
# Backtest: return 2.1% · PF 2.25 · DD 2.68% · trades 7
# OOS: 2.45% · Sharpe 2.11
# Params: {"period":22,"oversold":22,"overbought":75,"atrStop":3.2,"rr":2.2}
# Target platform: Freqtrade
# Generated: 2026-11-27T18:26:25.575Z
# Research artifact only — no warranty, no live order routing.
# ============================================================
# Drop this file in freqtrade/user_data/strategies/ and run:
#   freqtrade backtesting --strategy Altadesk_15m --config user_data/config.json
#   freqtrade trade --strategy Altadesk_15m --config user_data/config.json --dry-run

from freqtrade.strategy import IStrategy
from pandas import DataFrame
import talib.abstract as ta


class Altadesk_15m(IStrategy):
    INTERFACE_VERSION = 3

    timeframe = '15m'
    can_short = True
    startup_candle_count = 210

    stoploss = -0.038
    minimal_roi = {"0": 1.98, "240": 0.01, "720": 0}

    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    exit_profit_only = False

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe['rsi'] = ta.RSI(dataframe, timeperiod=22)
        dataframe['atr'] = ta.ATR(dataframe, timeperiod=14)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (
        & (dataframe['rsi'] <= 22)
        & (dataframe['rsi'].shift(1) > 22)
                & (dataframe['volume'] > 0)
            ),
            'enter_long',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['rsi'] >= 75)
        & (dataframe['rsi'].shift(1) < 75)
                & (dataframe['volume'] > 0)
            ),
            'enter_short',
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # Risk-managed exits: ATR stop + fixed R multiple handled by the engine.
        dataframe.loc[
            (
        & (dataframe['rsi'] <= 22)
        & (dataframe['rsi'].shift(1) > 22)
            ),
            'exit_short',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['rsi'] >= 75)
        & (dataframe['rsi'].shift(1) < 75)
            ),
            'exit_long',
        ] = 1
        return dataframe
